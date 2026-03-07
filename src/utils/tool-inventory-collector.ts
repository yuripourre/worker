import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { WorkerToolInventory } from '../shared';

const TOOL_BASE_DIR = './tools';

/**
 * Scan the local ./tools directory and return the current tool inventory.
 * Each subdirectory is treated as an installed tool; the type is inferred
 * from the files it contains.
 * @param baseDir - Optional override for tools directory (e.g. for tests).
 */
export function collectToolInventory(baseDir?: string): WorkerToolInventory {
  const dir = baseDir ?? TOOL_BASE_DIR;
  if (!existsSync(dir)) {
    return { lastUpdated: new Date().toISOString(), tools: [] };
  }

  const tools: WorkerToolInventory['tools'] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const toolName = entry.name;
      const toolDir = join(dir, toolName);
      const type = detectToolType(toolDir);
      tools.push({ name: toolName, type });
    }
  } catch {
    // Return empty list on any error
  }

  return { lastUpdated: new Date().toISOString(), tools };
}

/** Infer tool type from the files present in a tool directory. */
function detectToolType(toolDir: string): string {
  try {
    const files = readdirSync(toolDir);
    if (files.some(f => f.endsWith('.sh'))) return 'bash';
    if (files.some(f => f.endsWith('.ts'))) return 'typescript';
    if (files.some(f => f.endsWith('.zip'))) return 'zip';
    // Executable binary: no recognized extension
    const execFiles = files.filter(f => {
      try {
        const mode = statSync(join(toolDir, f)).mode;
        return (mode & 0o111) !== 0; // Has execute bit
      } catch {
        return false;
      }
    });
    if (execFiles.length > 0) return 'binary';
  } catch {
    // ignore
  }
  return 'unknown';
}
