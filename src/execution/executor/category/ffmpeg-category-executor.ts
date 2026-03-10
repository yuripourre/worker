import { ExecutableJob, ExecutableJobResult } from '../../types';
import { CategoryExecutor } from './category-executor';
import { isFFMPEGJobContext } from '../../../shared';
import { spawn } from 'child_process';

const DEFAULT_FFMPEG_TIMEOUT_SEC = 600;

/**
 * FFMPEG Category Executor
 * Runs ffmpeg with job-supplied arguments on the worker
 */
export class FFMPEGCategoryExecutor implements CategoryExecutor {
  async executePlan(job: ExecutableJob): Promise<ExecutableJobResult> {
    return {
      status: 'success',
      answer: 'FFMPEG execution plan: Run ffmpeg with the provided arguments.',
    };
  }

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isFFMPEGJobContext(job.context)) {
      throw new Error('Invalid context for FFMPEG job');
    }

    const { args, workingDirectory, timeout: timeoutSec } = job.context;
    const timeout = (timeoutSec ?? DEFAULT_FFMPEG_TIMEOUT_SEC) * 1000;

    try {
      const result = await this.runFfmpeg(args, workingDirectory, timeout);
      return {
        status: 'success',
        answer: JSON.stringify(
          { stdout: result.stdout, stderr: result.stderr, exitCode: 0 },
          null,
          2
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'failed',
        answer: `FFMPEG execution failed: ${message}`,
      };
    }
  }

  async executeReview(job: ExecutableJob, _childAnswers: Map<string, string>): Promise<ExecutableJobResult> {
    return {
      status: 'success',
      answer: 'FFMPEG execution review completed.',
    };
  }

  private runFfmpeg(
    args: string[],
    workingDirectory?: string,
    timeoutMs: number = DEFAULT_FFMPEG_TIMEOUT_SEC * 1000
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args, {
        cwd: workingDirectory || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`ffmpeg timed out after ${timeoutMs / 1000} seconds. stderr: ${stderr.slice(-500)}`));
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        if (code === 0) {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        } else {
          reject(
            new Error(`ffmpeg exited with code ${code}. stderr: ${stderr.trim().slice(-2000)}`)
          );
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to start ffmpeg: ${err.message}`));
      });
    });
  }
}
