import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

const TOOL_BASE_DIR = './tools';
const TOOL_TIMEOUT_MS = 30_000;

/**
 * Determine how to invoke a tool file based on its extension.
 * Returns [command, ...extraArgs] where the file path is appended after extraArgs.
 */
function resolveCommand(filePath: string): [string, ...string[]] {
  if (filePath.endsWith('.sh')) return ['bash', filePath];
  if (filePath.endsWith('.ts')) return ['bun', filePath];
  if (filePath.endsWith('.js')) return ['bun', filePath];
  return [filePath];
}

/**
 * Find the entry-point file inside a tool's directory.
 * If entryPoint is provided, that file is used (relative to toolDir).
 * Otherwise, auto-detects by looking for index.sh, main.sh, index.ts, main.ts,
 * or any single file in the directory.
 */
function findEntryPoint(toolDir: string, entryPoint?: string): string | null {
  if (entryPoint) {
    const resolved = join(toolDir, entryPoint);
    return existsSync(resolved) ? resolved : null;
  }

  const candidates = ['index.sh', 'main.sh', 'index.ts', 'main.ts', 'index', 'main'];
  for (const name of candidates) {
    const p = join(toolDir, name);
    if (existsSync(p)) return p;
  }

  // Fall back: single file in the directory
  try {
    const entries = readdirSync(toolDir);
    if (entries.length === 1) return join(toolDir, entries[0]);
  } catch {
    // ignore
  }
  return null;
}

/** Options for runLocalTool (e.g. baseDir for tests). */
export interface RunLocalToolOptions {
  baseDir?: string;
}

/**
 * Run a locally installed tool as a subprocess.
 * - Input: JSON-serialised args written to the child's stdin.
 * - Output: whatever the child writes to stdout (expected to be a string or JSON).
 * - On non-zero exit or timeout: throws an Error containing stderr.
 */
export async function runLocalTool(
  toolName: string,
  args: Record<string, unknown>,
  entryPoint?: string,
  options?: RunLocalToolOptions
): Promise<string> {
  const baseDir = options?.baseDir ?? TOOL_BASE_DIR;
  const toolDir = join(baseDir, toolName);
  if (!existsSync(toolDir)) {
    throw new Error(`Tool "${toolName}" is not installed (directory not found: ${toolDir})`);
  }

  const entryFile = findEntryPoint(toolDir, entryPoint);
  if (!entryFile) {
    throw new Error(`Could not find entry point for tool "${toolName}" in ${toolDir}`);
  }

  const [cmd, ...cmdArgs] = resolveCommand(entryFile);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Tool "${toolName}" timed out after ${TOOL_TIMEOUT_MS}ms`));
    }, TOOL_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
      if (code !== 0) {
        reject(new Error(`Tool "${toolName}" exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
        return;
      }
      resolve(stdout);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn tool "${toolName}": ${err.message}`));
    });

    // Write args as JSON to stdin then close it (_tool for dispatch bundle routing)
    try {
      child.stdin.write(JSON.stringify({ _tool: toolName, ...args }));
      child.stdin.end();
    } catch (err) {
      clearTimeout(timer);
      reject(new Error(`Failed to write args for tool "${toolName}": ${err instanceof Error ? err.message : String(err)}`));
    }
  });
}
