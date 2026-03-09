import { ExecutableJob, ExecutableJobResult } from '../../types';
import { CategoryExecutor } from './category-executor';
import { isFileFetchJobContext } from '../../../shared';
import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipelineAsync = promisify(pipeline);

/**
 * File Fetch Category Executor
 * Downloads an artifact from storage to a local path on the worker.
 * Replaces the /upload endpoint previously served by the local server.
 */
export class FileFetchCategoryExecutor implements CategoryExecutor {
  constructor(private baseUrl?: string) {}

  async executePlan(job: ExecutableJob): Promise<ExecutableJobResult> {
    return { status: 'success', answer: 'File fetch plan completed' };
  }

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isFileFetchJobContext(job.context)) {
      throw new Error('Invalid context for FILE_FETCH job');
    }
    const { artifactUrl, destinationPath } = job.context;

    const absPath = resolve(destinationPath);
    const dir = dirname(absPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const response = await fetch(artifactUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch artifact from ${artifactUrl}: HTTP ${response.status}`);
    }

    const fileStream = createWriteStream(absPath);
    await pipelineAsync(response.body as any, fileStream);

    console.log(`📥 File fetched via job: ${absPath}`);
    return { status: 'success', answer: JSON.stringify({ success: true, filePath: absPath }) };
  }

  async executeReview(job: ExecutableJob, _childAnswers: Map<string, string>): Promise<ExecutableJobResult> {
    return { status: 'success', answer: 'File fetch review completed' };
  }
}
