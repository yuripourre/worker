import { existsSync, readdirSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { homedir } from 'os';
import { COMFYUI_PATH_RESOLUTION } from '../config/constants';

const MODELS_DIR = COMFYUI_PATH_RESOLUTION.MODELS_DIR;
const CANDIDATE_SUFFIXES = COMFYUI_PATH_RESOLUTION.CANDIDATE_SUFFIXES;
const MAX_SEARCH_DEPTH = COMFYUI_PATH_RESOLUTION.MAX_SEARCH_DEPTH;

/**
 * Returns true if the given path looks like a ComfyUI root (has a "models" subdirectory).
 */
function isComfyUIRoot(candidatePath: string): boolean {
  const modelsPath = join(candidatePath, MODELS_DIR);
  return existsSync(modelsPath);
}

/**
 * Search for a ComfyUI root under baseDir up to maxDepth levels. Returns the first valid path.
 */
function findComfyUIRootUnder(baseDir: string, currentDepth: number): string | undefined {
  if (currentDepth > MAX_SEARCH_DEPTH) return undefined;
  try {
    const entries = readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (CANDIDATE_SUFFIXES.includes(name as (typeof CANDIDATE_SUFFIXES)[number])) {
        const candidate = join(baseDir, name);
        if (isComfyUIRoot(candidate)) {
          return resolve(candidate);
        }
      }
      const nextPath = join(baseDir, name);
      const found = findComfyUIRootUnder(nextPath, currentDepth + 1);
      if (found) return found;
    }
  } catch {
    // ignore permission errors or non-directories
  }
  return undefined;
}

/**
 * Resolves the ComfyUI root path at startup. Order:
 * 1. COMFYUI_PATH env (if set and valid)
 * 2. COMFYUI_MODELS_PATH env (if set and basename is "models", use parent as root)
 * 3. Infer by depth-limited search under cwd and homedir (max depth from constants)
 * Returns undefined if none found.
 */
export function resolveComfyUIPath(): string | undefined {
  const envPath = typeof process !== 'undefined' ? process.env.COMFYUI_PATH : undefined;
  if (envPath) {
    const resolved = resolve(envPath);
    if (isComfyUIRoot(resolved)) {
      return resolved;
    }
  }

  const envModelsPath = typeof process !== 'undefined' ? process.env.COMFYUI_MODELS_PATH : undefined;
  if (envModelsPath && basename(envModelsPath) === MODELS_DIR) {
    const root = dirname(resolve(envModelsPath));
    if (isComfyUIRoot(root)) {
      return root;
    }
  }

  const cwd = typeof process !== 'undefined' ? process.cwd() : '';
  const home = homedir();
  const baseDirs = [cwd, home];

  for (const base of baseDirs) {
    if (!base) continue;
    const found = findComfyUIRootUnder(base, 1);
    if (found) return found;
  }

  return undefined;
}
