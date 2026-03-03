import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Get the current worker version from package.json
 */
export function getWorkerVersion(): string {
  try {
    // First try environment variable (highest priority)
    if (process.env.WORKER_VERSION) {
      return process.env.WORKER_VERSION;
    }

    // Get the directory of the current module
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    // Try multiple possible paths for package.json
    const possiblePaths = [
      join(__dirname, '../../package.json'), // From utils to packages/worker
      join(__dirname, '../../../package.json'), // From dist/utils to packages/worker
      join(process.cwd(), 'package.json'), // Current working directory
      join(process.cwd(), 'packages/worker/package.json'), // Monorepo structure
    ];
    
    for (const packageJsonPath of possiblePaths) {
      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          if (packageJson.version) {
            return packageJson.version;
          }
        } catch (parseError) {
          // Continue to next path if parsing fails
          continue;
        }
      }
    }
    
    // Final fallback
    return '0.0.0';
  } catch (error) {
    console.warn('Failed to read worker version:', error);
    return process.env.WORKER_VERSION || '0.0.0';
  }
}

/**
 * Compare two semantic versions
 * Returns: -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  const maxLength = Math.max(parts1.length, parts2.length);
  
  for (let i = 0; i < maxLength; i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    
    if (part1 < part2) return -1;
    if (part1 > part2) return 1;
  }
  
  return 0;
}

