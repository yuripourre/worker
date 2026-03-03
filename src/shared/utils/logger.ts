/**
 * Minimal structured logger for server and worker.
 * Supports optional component tag; output can be extended for JSON in production.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  component?: string;
  level?: LogLevel;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private component: string;
  private minLevel: number;

  constructor(options: LoggerOptions = {}) {
    this.component = options.component ?? 'app';
    const level = options.level ?? 'info';
    this.minLevel = LEVEL_ORDER[level];
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= this.minLevel;
  }

  private format(level: LogLevel, message: string, err?: unknown): string {
    const prefix = `[${this.component}] ${level}:`;
    if (err !== undefined) {
      const errStr = err instanceof Error ? err.message : String(err);
      return `${prefix} ${message} ${errStr}`;
    }
    return `${prefix} ${message}`;
  }

  debug(message: string): void {
    if (this.shouldLog('debug')) console.debug(this.format('debug', message));
  }

  info(message: string): void {
    if (this.shouldLog('info')) console.log(this.format('info', message));
  }

  warn(message: string, err?: unknown): void {
    if (this.shouldLog('warn')) console.warn(this.format('warn', message, err));
  }

  error(message: string, err?: unknown): void {
    if (this.shouldLog('error')) console.error(this.format('error', message, err));
  }
}

export function createLogger(component: string, level?: LogLevel): Logger {
  return new Logger({ component, level });
}
