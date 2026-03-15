import { ExecutableJob, ExecutableJobResult } from '../../types';
import { LLMClient } from '../../llm-client';
import { CategoryExecutor } from './category-executor';
import { spawn } from 'child_process';
import { isScriptJobContext } from '../../../shared';
import type { Workspace } from '../../../shared';

export class ScriptCategoryExecutor implements CategoryExecutor {
  constructor(
    private llmClient: LLMClient,
    private baseUrl?: string,
    private deviceId?: string,
    private workerId?: string,
    private getWorkspaces?: () => Workspace[]
  ) {}

  async executePlan(job: ExecutableJob): Promise<ExecutableJobResult> {
    return { status: 'success', answer: 'Script execution plan: Execute the provided script directly.' };
  }

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isScriptJobContext(job.context)) {
      throw new Error('Script context is required for script jobs');
    }

    try {
      const result = await this.executeScript(job.context);
      return { status: 'success', answer: result.output };
    } catch (error) {
      return {
        status: 'failed',
        answer: `Script execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async executeReview(job: ExecutableJob, childAnswers: Map<string, string>): Promise<ExecutableJobResult> {
    return { status: 'success', answer: 'Script execution review: No review needed for script jobs.' };
  }

  private async executeScript(scriptContext: any): Promise<{ output: string; error?: string }> {
    return new Promise((resolve, reject) => {
      const {
        scriptContent,
        language = 'bash',
        timeout = 300,
        workingDirectory,
        environment = {},
        input,
        args = [],
        workspaceId,
      } = scriptContext;

      // Resolve workingDirectory from workspace if workspaceId set and no explicit workingDirectory
      let cwd = workingDirectory || process.cwd();
      if (workspaceId && !workingDirectory && this.getWorkspaces) {
        const workspaces = this.getWorkspaces();
        const ws = workspaces.find((w: Workspace) => w.id === workspaceId);
        if (ws) cwd = ws.rootPath;
      }

      let command: string;
      let cmdArgs: string[] = [];

      switch (language.toLowerCase()) {
        case 'python':
        case 'py':
          command = 'python3';
          cmdArgs = ['-c', scriptContent, ...args];
          break;
        case 'javascript':
        case 'js':
          command = 'node';
          cmdArgs = ['-e', scriptContent, ...args];
          break;
        case 'bash':
        case 'sh':
          command = 'bash';
          cmdArgs = ['-c', scriptContent, '--', ...args];
          break;
        case 'powershell':
        case 'ps1':
          command = 'powershell';
          cmdArgs = ['-Command', scriptContent];
          break;
        case 'cmd':
        case 'batch':
          command = 'cmd';
          cmdArgs = ['/c', scriptContent];
          break;
        default:
          command = 'bash';
          cmdArgs = ['-c', scriptContent, '--', ...args];
      }

      const env = { ...process.env, ...environment };
      const child = spawn(command, cmdArgs, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Feed stdin if provided
      if (input != null) {
        child.stdin?.write(input);
      }
      child.stdin?.end();

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      let exitCode = 0;
      child.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        exitCode = code ?? 0;
        resolve({
          output: JSON.stringify({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }),
        });
      });

      child.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to start script: ${error.message}`));
      });

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Script execution timed out after ${timeout} seconds`));
      }, timeout * 1000);
    });
  }
}
