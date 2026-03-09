import { ExecutableJob, ExecutableJobResult } from '../../types';
import { CategoryExecutor } from './category-executor';
import { isWorkerConfigJobContext } from '../../../shared';
import { mkdirSync, existsSync } from 'fs';
import { join, basename, resolve } from 'path';

/**
 * Worker Config Category Executor
 * Handles WORKER_CONFIG jobs: get/set runtime configuration and create folders.
 * Replaces the /config/* and /files/create-folder endpoints previously served by
 * the local server on port 51115.
 */
export class WorkerConfigCategoryExecutor implements CategoryExecutor {
  constructor(
    private getConfig?: () => { comfyuiPath?: string; comfyuiBaseUrl?: string; ollamaBaseUrl?: string },
    private setConfig?: (updates: { comfyuiPath?: string; comfyuiBaseUrl?: string; ollamaBaseUrl?: string }) => void
  ) {}

  async executePlan(job: ExecutableJob): Promise<ExecutableJobResult> {
    return { status: 'success', answer: 'Worker config plan completed' };
  }

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isWorkerConfigJobContext(job.context)) {
      throw new Error('Invalid context for WORKER_CONFIG job');
    }
    const ctx = job.context;

    if (ctx.operation === 'get') {
      const config = this.getConfig?.() ?? {};
      return { status: 'success', answer: JSON.stringify(config) };
    }

    if (ctx.operation === 'set') {
      const updates: { comfyuiPath?: string; comfyuiBaseUrl?: string; ollamaBaseUrl?: string } = {};
      if (ctx.comfyuiPath !== undefined) updates.comfyuiPath = ctx.comfyuiPath;
      if (ctx.comfyuiBaseUrl !== undefined) updates.comfyuiBaseUrl = ctx.comfyuiBaseUrl;
      if (ctx.ollamaBaseUrl !== undefined) updates.ollamaBaseUrl = ctx.ollamaBaseUrl;
      this.setConfig?.(updates);
      return { status: 'success', answer: JSON.stringify({ success: true }) };
    }

    if (ctx.operation === 'create-folder') {
      if (!ctx.folderName) {
        return { status: 'failed', answer: 'folderName is required for create-folder' };
      }
      const safeName = basename(ctx.folderName.trim().replace(/[/\\]/g, '_'));
      const parent = ctx.parentPath ? resolve(ctx.parentPath) : resolve(process.cwd());
      if (!existsSync(parent)) {
        return { status: 'failed', answer: `Parent directory does not exist: ${parent}` };
      }
      const full = join(parent, safeName);
      if (existsSync(full)) {
        return { status: 'failed', answer: `Folder already exists: ${safeName}` };
      }
      mkdirSync(full, { recursive: false });
      console.log(`📁 Folder created via job: ${full}`);
      return { status: 'success', answer: JSON.stringify({ success: true, folderPath: full }) };
    }

    return { status: 'failed', answer: `Unknown operation: ${(ctx as any).operation}` };
  }

  async executeReview(job: ExecutableJob, _childAnswers: Map<string, string>): Promise<ExecutableJobResult> {
    return { status: 'success', answer: 'Worker config review completed' };
  }
}
