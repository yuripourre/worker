import { spawn } from 'child_process';

export interface TerminalCommandRequest {
  command: string;
  timeout?: number;
  workingDirectory?: string;
}

export interface TerminalCommandResponse {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}

export class TerminalService {
  private readonly DEFAULT_TIMEOUT = 300000; // 5 minutes

  /**
   * Execute terminal command
   */
  async executeCommand(request: TerminalCommandRequest): Promise<TerminalCommandResponse> {
    return new Promise((resolve, reject) => {
      const { command, timeout = this.DEFAULT_TIMEOUT, workingDirectory } = request;

      // Determine the shell to use based on platform
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd.exe' : '/bin/bash';
      const shellArgs = isWindows ? ['/c'] : ['-c'];

      const child = spawn(shell, [...shellArgs, command], {
        cwd: workingDirectory || process.cwd(),
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';
      let timeoutId: NodeJS.Timeout | null = null;

      // Set timeout if specified
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command timeout after ${timeout}ms`));
        }, timeout);
      }

      // Capture stdout
      child.stdout?.on('data', (data) => {
        output += data.toString();
      });

      // Capture stderr
      child.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      // Handle process completion
      child.on('close', (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        const result: TerminalCommandResponse = {
          success: code === 0,
          output: output.trim(),
          error: errorOutput.trim() || undefined,
          exitCode: code ?? undefined
        };

        resolve(result);
      });

      child.on('error', (error) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        reject(error);
      });
    });
  }
}


















