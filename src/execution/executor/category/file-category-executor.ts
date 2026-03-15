import { ExecutableJob, ExecutableJobResult } from '../../types';
import { CategoryExecutor } from './category-executor';
import { isFileJobContext, FILE_OPERATIONS } from '../../../shared';
import type { Workspace } from '../../../shared';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync, statSync, renameSync, existsSync, rmSync } from 'fs';
import { join, dirname, basename } from 'path';

export class FileCategoryExecutor implements CategoryExecutor {
  constructor(
    private baseUrl?: string,
    private deviceId?: string,
    private workerId?: string,
    private getWorkspaces?: () => Workspace[]
  ) {}

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isFileJobContext(job.context)) {
      throw new Error('File context is required for file jobs');
    }

    const ctx = job.context;
    let rootPath = '';

    // Resolve workspace rootPath if workspaceId provided
    if (ctx.workspaceId && this.getWorkspaces) {
      const workspaces = this.getWorkspaces();
      const ws = workspaces.find(w => w.id === ctx.workspaceId);
      if (ws) rootPath = ws.rootPath;
    }

    const resolvePath = (p: string): string => {
      if (!p) return rootPath || process.cwd();
      if (rootPath && !p.startsWith('/')) return join(rootPath, p);
      return p;
    };

    try {
      switch (ctx.operation) {
        case FILE_OPERATIONS.LIST: {
          const dirPath = resolvePath(ctx.path);
          const entries = readdirSync(dirPath);
          const files = entries.map(name => {
            const fullPath = join(dirPath, name);
            try {
              const stat = statSync(fullPath);
              return {
                name,
                size: stat.size,
                isDirectory: stat.isDirectory(),
                modified: stat.mtime.toISOString(),
              };
            } catch {
              return { name, size: 0, isDirectory: false, modified: new Date().toISOString() };
            }
          });
          const parentPath = dirname(dirPath) !== dirPath ? dirname(dirPath) : null;
          return {
            status: 'success',
            answer: JSON.stringify({ files, currentPath: dirPath, parentPath }),
          };
        }

        case FILE_OPERATIONS.READ: {
          const filePath = resolvePath(ctx.path);
          let text: string;
          try {
            text = readFileSync(filePath, 'utf-8');
          } catch {
            // Binary fallback
            const buf = readFileSync(filePath);
            text = JSON.stringify({ base64: buf.toString('base64'), encoding: 'base64' });
          }
          return { status: 'success', answer: text };
        }

        case FILE_OPERATIONS.WRITE: {
          const filePath = resolvePath(ctx.path);
          mkdirSync(dirname(filePath), { recursive: true });

          if (ctx.artifactJobId && this.baseUrl) {
            // Fetch artifact from server and write
            const artifactName = ctx.artifactName || basename(filePath);
            const artifactUrl = `${this.baseUrl}/api/jobs/${ctx.artifactJobId}/artifacts/${encodeURIComponent(artifactName)}`;
            const response = await fetch(artifactUrl);
            if (!response.ok) throw new Error(`Failed to fetch artifact: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            writeFileSync(filePath, Buffer.from(arrayBuffer));
          } else if (ctx.content != null) {
            // Check if content is base64
            let buf: Buffer;
            try {
              const parsed = JSON.parse(ctx.content);
              if (parsed && parsed.encoding === 'base64' && parsed.data) {
                buf = Buffer.from(parsed.data, 'base64');
              } else {
                buf = Buffer.from(ctx.content, 'utf-8');
              }
            } catch {
              buf = Buffer.from(ctx.content, 'utf-8');
            }
            writeFileSync(filePath, buf);
          } else {
            throw new Error('Either content or artifactJobId is required for write operation');
          }
          return { status: 'success', answer: JSON.stringify({ success: true, path: filePath }) };
        }

        case FILE_OPERATIONS.UPLOAD: {
          // Alias: fetch artifact and write to path
          const filePath = resolvePath(ctx.path);
          mkdirSync(dirname(filePath), { recursive: true });
          if (!ctx.artifactJobId || !this.baseUrl) {
            throw new Error('artifactJobId and baseUrl are required for upload operation');
          }
          const artifactName = ctx.artifactName || basename(filePath);
          const artifactUrl = `${this.baseUrl}/api/jobs/${ctx.artifactJobId}/artifacts/${encodeURIComponent(artifactName)}`;
          const response = await fetch(artifactUrl);
          if (!response.ok) throw new Error(`Failed to fetch artifact: ${response.statusText}`);
          const arrayBuffer = await response.arrayBuffer();
          writeFileSync(filePath, Buffer.from(arrayBuffer));
          return { status: 'success', answer: JSON.stringify({ success: true, path: filePath }) };
        }

        case FILE_OPERATIONS.DELETE: {
          const filePath = resolvePath(ctx.path);
          if (ctx.recursive) {
            rmSync(filePath, { recursive: true, force: true });
          } else {
            unlinkSync(filePath);
          }
          return { status: 'success', answer: JSON.stringify({ success: true }) };
        }

        case FILE_OPERATIONS.CREATE_FOLDER: {
          const folderPath = resolvePath(ctx.path);
          mkdirSync(folderPath, { recursive: true });
          return { status: 'success', answer: JSON.stringify({ success: true, path: folderPath }) };
        }

        case FILE_OPERATIONS.MOVE: {
          const srcPath = resolvePath(ctx.path);
          const destPath = resolvePath(ctx.destination || '');
          if (!ctx.destination) throw new Error('destination is required for move operation');
          mkdirSync(dirname(destPath), { recursive: true });
          renameSync(srcPath, destPath);
          return { status: 'success', answer: JSON.stringify({ success: true }) };
        }

        case FILE_OPERATIONS.DOWNLOAD: {
          if (!this.baseUrl || !job.id) throw new Error('baseUrl and job ID are required for download operation');
          const filePath = resolvePath(ctx.path);
          const fileBuffer = readFileSync(filePath);
          const fileName = basename(filePath);

          // POST artifact to server
          const formData = new FormData();
          const blob = new Blob([fileBuffer]);
          formData.append('file', blob, fileName);

          const uploadUrl = `${this.baseUrl}/api/jobs/${job.id}/artifacts`;
          const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData,
          });
          if (!response.ok) throw new Error(`Failed to upload artifact: ${response.statusText}`);

          const artifactUrl = `${this.baseUrl}/api/jobs/${job.id}/artifacts/${encodeURIComponent(fileName)}`;
          return {
            status: 'success',
            answer: JSON.stringify({ artifactUrl, fileName }),
          };
        }

        default:
          throw new Error(`Unknown file operation: ${(ctx as any).operation}`);
      }
    } catch (error) {
      return {
        status: 'failed',
        answer: `File operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
