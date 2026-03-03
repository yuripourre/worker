import { ExecutableJob, ExecutableJobResult } from '../../types';
import { LLMClient } from '../../llm-client';
import { CategoryExecutor } from './category-executor';
import { spawn } from 'child_process';
import { isScriptJobContext } from '../../../shared';
import { OutputArtifactHelper } from '../output-artifact-helper';

/**
 * Script Category Executor
 * Handles script execution jobs
 */
export class ScriptCategoryExecutor implements CategoryExecutor {
  constructor(
    private llmClient: LLMClient,
    private baseUrl?: string,
    private deviceId?: string,
    private workerId?: string
  ) {}

  async executePlan(job: ExecutableJob): Promise<ExecutableJobResult> {
    // Dummy implementation for script jobs - no planning needed
    return {
      status: 'success',
      answer: 'Script execution plan: Execute the provided script directly in terminal.'
    };
  }

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isScriptJobContext(job.context)) {
      throw new Error('Script context is required for script jobs');
    }

    try {
      // Execute the script in terminal
      const result = await this.executeScript(job.context);

      const execResult: ExecutableJobResult = {
        status: 'success',
        answer: result.output
      };

      // Check if outputType is 'text' or 'image' and create artifact
      if (job.context.outputType) {
        const outputType = job.context.outputType;

        if (outputType === 'text' || outputType === 'image') {
          try {
            if (outputType === 'text') {
              // Save output as text artifact
              const artifact = await OutputArtifactHelper.createTextArtifact(
                job.id,
                result.output,
                this.workerId || 'unknown'
              );
              execResult.artifacts = [artifact];
            } else if (outputType === 'image') {
              // Extract image data from the output if present
              const extracted = OutputArtifactHelper.extractImageFromText(result.output);

              if (extracted.imageData) {
                const artifact = await OutputArtifactHelper.createImageArtifact(
                  job.id,
                  extracted.imageData,
                  this.workerId || 'unknown',
                  extracted.mimeType
                );
                execResult.artifacts = [artifact];
                execResult.answer = extracted.cleanText;
              } else {
                // No image data found, save as text artifact
                const artifact = await OutputArtifactHelper.createTextArtifact(
                  job.id,
                  result.output,
                  this.workerId || 'unknown'
                );
                execResult.artifacts = [artifact];
              }
            }
          } catch (error) {
            console.error(`Failed to create output artifact for job ${job.id}:`, error);
            // Don't fail the job, just log the error
          }
        }
      }

      return execResult;
    } catch (error) {
      return {
        status: 'failed',
        answer: `Script execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async executeReview(job: ExecutableJob, childAnswers: Map<string, string>): Promise<ExecutableJobResult> {
    // Dummy implementation for script jobs - no review needed
    return {
      status: 'success',
      answer: 'Script execution review: No review needed for script jobs.'
    };
  }

  private async executeScript(scriptContext: any): Promise<{output: string, error?: string}> {
    return new Promise((resolve, reject) => {
      const {
        scriptContent,
        language = 'bash',
        timeout = 300,
        workingDirectory,
        environment = {},
        detached = false,
        pidFile
      } = scriptContext;

      // Determine the command to run based on language
      let command: string;
      let args: string[] = [];

      switch (language.toLowerCase()) {
        case 'python':
        case 'py':
          command = 'python3';
          args = ['-c', scriptContent];
          break;
        case 'javascript':
        case 'js':
          command = 'node';
          args = ['-e', scriptContent];
          break;
        case 'bash':
        case 'sh':
          command = 'bash';
          args = ['-c', scriptContent];
          break;
        case 'powershell':
        case 'ps1':
          command = 'powershell';
          args = ['-Command', scriptContent];
          break;
        case 'cmd':
        case 'batch':
          command = 'cmd';
          args = ['/c', scriptContent];
          break;
        default:
          // Default to bash for unknown languages
          command = 'bash';
          args = ['-c', scriptContent];
      }

      // Set up environment variables
      const env = { ...process.env, ...environment };

      // Spawn the process
      const spawnOptions: any = {
        cwd: workingDirectory || process.cwd(),
        env,
        stdio: detached ? 'ignore' : ['pipe', 'pipe', 'pipe'],
        detached: detached
      };

      const child = spawn(command, args, spawnOptions);

      // If detached, unref the process so parent can exit
      if (detached) {
        child.unref();

        // Save PID to file if specified
        if (pidFile && child.pid) {
          const fs = require('fs');
          const path = require('path');
          const pidDir = require('path').dirname(pidFile);
          if (!fs.existsSync(pidDir)) {
            fs.mkdirSync(pidDir, { recursive: true });
          }
          fs.writeFileSync(pidFile, child.pid.toString(), 'utf-8');
        }

        // For detached processes, resolve immediately
        resolve({
          output: `Process started in background (PID: ${child.pid || 'unknown'})${pidFile ? `, PID saved to ${pidFile}` : ''}`,
          error: undefined
        });
        return;
      }

      let output = '';
      let errorOutput = '';

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
        if (code === 0) {
          resolve({
            output: output.trim(),
            error: errorOutput.trim() || undefined
          });
        } else {
          reject(new Error(`Script execution failed with exit code ${code}. Error: ${errorOutput}`));
        }
      });

      // Handle process errors
      child.on('error', (error) => {
        reject(new Error(`Failed to start script execution: ${error.message}`));
      });

      // Set timeout (only for non-detached processes)
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Script execution timed out after ${timeout} seconds`));
      }, timeout * 1000);

      // Clear timeout if process completes
      child.on('close', () => {
        clearTimeout(timeoutId);
      });
    });
  }

}
