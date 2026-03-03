import { randomBytes } from 'crypto';
import * as os from 'os';
import type { Subprocess } from 'bun';

export interface TerminalSessionConfig {
  sessionId: string;
  workingDirectory?: string;
  cols?: number;
  rows?: number;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class TerminalSession {
  private sessionId: string;
  private process: Subprocess | null = null;
  private workingDirectory: string;
  private isActive: boolean = false;
  private cols: number;
  private rows: number;

  constructor(config: TerminalSessionConfig) {
    this.sessionId = config.sessionId;
    this.workingDirectory = config.workingDirectory || process.cwd();
    this.cols = config.cols || DEFAULT_COLS;
    this.rows = config.rows || DEFAULT_ROWS;
  }

  /**
   * Start an interactive shell session with PTY using Python
   */
  start(onData: (data: string) => void, onError: (data: string) => void): void {
    if (this.isActive && this.process) {
      return;
    }

    try {
      const isWindows = process.platform === 'win32';
      const shell = isWindows
        ? process.env.COMSPEC || 'cmd.exe'
        : process.env.SHELL || '/bin/bash';

      const pythonPtyScript = `
import pty
import os
import sys
import select

# Set terminal size
os.environ['COLUMNS'] = '${this.cols}'
os.environ['LINES'] = '${this.rows}'

def main():
    try:
        # Fork and create PTY
        pid, fd = pty.fork()
        
        if pid == 0:
            # Child process - exec the shell
            os.execvp('${shell}', ['${shell}'])
        else:
            # Parent process - relay I/O
            try:
                while True:
                    # Use select to handle both stdin and PTY output
                    r, w, e = select.select([sys.stdin.buffer, fd], [], [])
                    
                    if sys.stdin.buffer in r:
                        # Read from stdin and write to PTY
                        data = os.read(sys.stdin.fileno(), 1024)
                        if not data:
                            break
                        os.write(fd, data)
                    
                    if fd in r:
                        # Read from PTY and write to stdout
                        try:
                            data = os.read(fd, 1024)
                            if not data:
                                break
                            sys.stdout.buffer.write(data)
                            sys.stdout.buffer.flush()
                        except OSError:
                            break
            except (KeyboardInterrupt, EOFError):
                pass
    except Exception as e:
        sys.stderr.write(f"PTY error: {e}\\n")
        sys.exit(1)

if __name__ == '__main__':
    main()
`.trim();

      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        TERM: 'xterm-256color',
        COLUMNS: this.cols.toString(),
        LINES: this.rows.toString(),
      };

      this.process = Bun.spawn(['python3', '-c', pythonPtyScript], {
        cwd: this.workingDirectory,
        env,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      this.isActive = true;

      // Handle stdout
      (async () => {
        try {
          if (this.process && typeof this.process.stdout !== 'number') {
            const reader = (this.process.stdout as ReadableStream).getReader();
            const decoder = new TextDecoder();

            while (this.isActive) {
              const { done, value } = await reader.read();
              if (done) break;

              const text = decoder.decode(value as Uint8Array, { stream: true });
              onData(text);
            }
          }
        } catch (error) {
          console.error('Error reading stdout:', error);
        }
      })();

      (async () => {
        try {
          if (this.process && typeof this.process.stderr !== 'number') {
            const reader = (this.process.stderr as ReadableStream).getReader();
            const decoder = new TextDecoder();

            while (this.isActive) {
              const { done, value } = await reader.read();
              if (done) break;

              const text = decoder.decode(value as Uint8Array, { stream: true });
              onData(text);
            }
          }
        } catch (error) {
          console.error('Error reading stderr:', error);
        }
      })();

      this.process.exited.then((exitCode) => {
        this.isActive = false;

        if (exitCode !== 0) {
          onError(`\r\n\r\nProcess exited with code ${exitCode}\r\n`);
        }

        this.process = null;
      }).catch((error) => {
        console.error('Process exit error:', error);
        this.isActive = false;
        this.process = null;
      });
    } catch (error) {
      this.isActive = false;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to start terminal session:', errorMessage);
      onError(`Failed to start terminal: ${errorMessage}\r\n`);
    }
  }

  /**
   * Write input to the terminal
   */
  write(data: string | Buffer): void {
    if (!this.process || !this.isActive) {
      return;
    }

    try {
      if (this.process.stdin && typeof this.process.stdin !== 'number') {
        const dataStr = typeof data === 'string' ? data : data.toString('utf-8');
        (this.process.stdin as any).write(dataStr);
      }
    } catch (error) {
      console.error('Error writing to terminal:', error);
    }
  }

  /**
   * Resize the terminal
   */
  resize(cols: number, rows: number): void {
    if (!this.process || !this.isActive) {
      return;
    }

    try {
      const validCols = Math.max(1, Math.min(cols, 500));
      const validRows = Math.max(1, Math.min(rows, 200));

      this.cols = validCols;
      this.rows = validRows;

      if (this.process.pid) {
        this.process.kill('SIGWINCH');
      }
    } catch (error) {
      console.error('Error resizing terminal:', error);
    }
  }

  /**
   * Stop the terminal session
   */
  stop(): void {
    if (!this.process) {
      return;
    }

    try {
      this.isActive = false;
      this.process.kill();
      this.process = null;
    } catch (error) {
      console.error('Error stopping terminal:', error);
      this.process = null;
    }
  }

  /**
   * Check if session is active
   */
  getActive(): boolean {
    return this.isActive && this.process !== null;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get current terminal dimensions
   */
  getDimensions(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  /**
   * Change working directory for the session
   */
  setWorkingDirectory(path: string): void {
    this.workingDirectory = path;
    if (this.process && this.isActive) {
      this.write(`cd "${path}"\n`);
    }
  }
}

/**
 * Manager for terminal sessions
 */
export class TerminalSessionManager {
  private sessions: Map<string, TerminalSession> = new Map();

  /**
   * Create a new terminal session
   */
  createSession(workingDirectory?: string, cols?: number, rows?: number): TerminalSession {
    const sessionId = randomBytes(16).toString('hex');
    const session = new TerminalSession({
      sessionId,
      workingDirectory,
      cols,
      rows,
    });
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Remove a session
   */
  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.stop();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Clean up all sessions
   */
  cleanup(): void {
    for (const session of this.sessions.values()) {
      session.stop();
    }
    this.sessions.clear();
  }
}

