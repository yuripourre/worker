/**
 * FFMPEG Tool Availability Checker
 *
 * Checks if the ffmpeg binary is available on the system
 */

import { spawn } from 'child_process';
import { CapabilityChecker, CapabilityCheckResult } from '../../utils/tool-availability-checker';

const FFMPEG_CHECK_TIMEOUT_MS = 5000;

export class FfmpegChecker implements CapabilityChecker {
  name = 'ffmpeg';

  async check(): Promise<CapabilityCheckResult> {
    return new Promise((resolve) => {
      const child = spawn('ffmpeg', ['-version'], {
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
        resolve({
          name: this.name,
          available: false,
          error: `ffmpeg check timed out after ${FFMPEG_CHECK_TIMEOUT_MS / 1000} seconds`,
        });
      }, FFMPEG_CHECK_TIMEOUT_MS);

      child.on('close', (code, signal) => {
        clearTimeout(timeoutId);
        if (code === 0 || (code === null && signal === 'SIGTERM')) {
          const versionMatch = (stdout || stderr).match(/ffmpeg version ([\S]+)/);
          const version = versionMatch ? versionMatch[1] : undefined;
          resolve({
            name: this.name,
            available: true,
            version,
            details: version ? `ffmpeg ${version} available` : 'ffmpeg available',
          });
        } else {
          resolve({
            name: this.name,
            available: false,
            error: code != null
              ? `ffmpeg exited with code ${code}`
              : `ffmpeg failed: ${signal ?? 'unknown'}`,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutId);
        resolve({
          name: this.name,
          available: false,
          error: err.message,
        });
      });
    });
  }
}

/**
 * Create and register FFMPEG checker with the capability availability checker
 */
export function registerFfmpegChecker(): void {
  const { capabilityAvailabilityChecker } = require('../../utils/tool-availability-checker');
  const checker = new FfmpegChecker();
  capabilityAvailabilityChecker.registerChecker(checker);
}
