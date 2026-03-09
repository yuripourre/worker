import { ExecutableJob, ExecutableJobResult } from '../../types';
import { CategoryExecutor } from './category-executor';
import { isFileUploadJobContext } from '../../../shared';
import { existsSync, readFileSync } from 'fs';
import { basename, resolve } from 'path';

/**
 * File Upload Category Executor
 * Reads a local file and uploads it to artifact storage via the job server's
 * existing /api/jobs/:id/artifacts endpoint.
 * Replaces the /download endpoint previously served by the local server.
 */
export class FileUploadCategoryExecutor implements CategoryExecutor {
  constructor(
    private baseUrl?: string,
    private deviceId?: string,
    private workerId?: string
  ) {}

  async executePlan(job: ExecutableJob): Promise<ExecutableJobResult> {
    return { status: 'success', answer: 'File upload plan completed' };
  }

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isFileUploadJobContext(job.context)) {
      throw new Error('Invalid context for FILE_UPLOAD job');
    }
    const absPath = resolve(job.context.filePath);
    if (!existsSync(absPath)) {
      return { status: 'failed', answer: `File not found: ${absPath}` };
    }

    const fileName = basename(absPath);
    const fileBuffer = readFileSync(absPath);

    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), fileName);

    if (!this.baseUrl) {
      return { status: 'failed', answer: 'baseUrl not configured; cannot upload artifact' };
    }

    const response = await fetch(`${this.baseUrl}/api/jobs/${job.id}/artifacts`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const msg = await response.text().catch(() => response.statusText);
      throw new Error(`Artifact upload failed (HTTP ${response.status}): ${msg}`);
    }

    const result = await response.json();
    console.log(`📤 File uploaded via job: ${absPath}`);
    return {
      status: 'success',
      answer: JSON.stringify({
        artifactUrl: result.storageUrl,
        storagePath: result.storagePath,
        fileName: result.fileName,
        fileSize: result.fileSize,
      }),
    };
  }

  async executeReview(job: ExecutableJob, _childAnswers: Map<string, string>): Promise<ExecutableJobResult> {
    return { status: 'success', answer: 'File upload review completed' };
  }
}
