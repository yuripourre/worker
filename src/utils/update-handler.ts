import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { getWorkerVersion } from './version-utils';

const execAsync = promisify(exec);

const DEFAULT_CLONE_PATH = join(homedir(), '.worker-update');

export interface UpdateOptions {
  /**
   * Method to use for update: 'git', 'server', 'manual', or 'repo'
   */
  method?: 'git' | 'server' | 'manual' | 'repo';

  /**
   * Git repository path (for git method)
   */
  gitPath?: string;

  /**
   * Server URL for downloading package (for server method)
   */
  serverUrl?: string;

  /**
   * Git clone URL for repo method (e.g. https://github.com/yuripourre/worker.git)
   */
  gitRepoUrl?: string;

  /**
   * Target directory for clone (repo method). Defaults to ~/.worker-update
   */
  clonePath?: string;

  /**
   * Whether to restart after update
   */
  restartAfterUpdate?: boolean;

  /**
   * Command to run after update (for manual method)
   */
  updateCommand?: string;

  /**
   * Callback to call after successful update (before restart)
   */
  onUpdateComplete?: () => void | Promise<void>;
}

/**
 * Check if we're in a git repository
 */
function isGitRepository(path: string): boolean {
  return existsSync(join(path, '.git'));
}

/**
 * Perform git pull to update the worker
 */
async function updateViaGit(gitPath: string): Promise<void> {
  try {
    console.log('📥 Pulling latest changes from git...');
    const { stdout, stderr } = await execAsync('git pull', { cwd: gitPath });

    if (stderr && !stderr.includes('Already up to date')) {
      console.warn('⚠️ Git pull warnings:', stderr);
    }

    console.log('✅ Git pull completed');
    if (stdout) {
      console.log(stdout);
    }

    // Check if we need to rebuild
    const newVersion = getWorkerVersion();
    console.log(`📦 New version: ${newVersion}`);

    // Rebuild the worker package
    console.log('🔨 Rebuilding worker package...');
    const buildPath = join(gitPath, 'packages/worker');
    const { stdout: buildStdout, stderr: buildStderr } = await execAsync(
      'bun run build',
      { cwd: buildPath }
    );

    if (buildStderr) {
      console.warn('⚠️ Build warnings:', buildStderr);
    }

    console.log('✅ Build completed');
    if (buildStdout) {
      console.log(buildStdout);
    }
  } catch (error) {
    console.error('❌ Git update failed:', error);
    throw error;
  }
}

/**
 * Download and install worker package from server
 */
async function updateViaServer(serverUrl: string, workerPath: string = process.cwd()): Promise<void> {
  try {
    console.log('📥 Downloading worker package from server...');
    console.log(`Server URL: ${serverUrl}`);

    // Download the package
    const downloadUrl = `${serverUrl}/api/workers/update-package`;
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      throw new Error(`Failed to download package: HTTP ${response.status}`);
    }

    // Create temporary directory for extraction
    const tempDir = join(tmpdir(), `worker-update-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const tarballPath = join(tempDir, 'worker-package.tar.gz');

    // Save the tarball
    const fileStream = createWriteStream(tarballPath);
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error('Failed to get response body reader');
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(Buffer.from(value));
    }

    fileStream.end();
    await new Promise<void>((resolve, reject) => {
      fileStream.on('finish', () => resolve());
      fileStream.on('error', reject);
    });

    console.log('✅ Package downloaded');

    // Extract the tarball
    console.log('📦 Extracting package...');
    const extractPath = join(tempDir, 'extracted');
    mkdirSync(extractPath, { recursive: true });

    // Extract using tar command
    const { stdout: extractStdout, stderr: extractStderr } = await execAsync(
      `tar -xzf "${tarballPath}" -C "${extractPath}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    if (extractStderr && !extractStderr.includes('Removing leading')) {
      console.warn('⚠️ Extract warnings:', extractStderr);
    }

    console.log('✅ Package extracted');

    // Copy extracted files to worker directory
    const extractedWorkerPath = join(extractPath, 'worker');
    if (!existsSync(extractedWorkerPath)) {
      throw new Error('Extracted package structure is invalid');
    }

    console.log('📋 Copying files to worker directory...');
    const { stdout: copyStdout, stderr: copyStderr } = await execAsync(
      `cp -r "${extractedWorkerPath}"/* "${workerPath}/"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    if (copyStderr) {
      console.warn('⚠️ Copy warnings:', copyStderr);
    }

    console.log('✅ Files copied');

    // Rebuild the worker package
    console.log('🔨 Rebuilding worker package...');
    const { stdout: buildStdout, stderr: buildStderr } = await execAsync(
      'bun run build',
      { cwd: workerPath, maxBuffer: 10 * 1024 * 1024 }
    );

    if (buildStderr) {
      console.warn('⚠️ Build warnings:', buildStderr);
    }

    console.log('✅ Build completed');
    if (buildStdout) {
      console.log(buildStdout);
    }

    // Clean up temp directory
    try {
      await execAsync(`rm -rf "${tempDir}"`);
    } catch (cleanupError) {
      console.warn('⚠️ Failed to clean up temp directory:', cleanupError);
    }
  } catch (error) {
    console.error('❌ Server update failed:', error);
    throw error;
  }
}

/**
 * Clone or pull repo, then install and build. Used for 'repo' update method.
 */
async function updateViaRepo(gitRepoUrl: string, clonePath: string): Promise<void> {
  try {
    const parentDir = join(clonePath, '..');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    if (existsSync(clonePath) && isGitRepository(clonePath)) {
      console.log('📥 Pulling latest changes from git...');
      const { stdout, stderr } = await execAsync('git pull', { cwd: clonePath });
      if (stderr && !stderr.includes('Already up to date')) {
        console.warn('⚠️ Git pull warnings:', stderr);
      }
      if (stdout) console.log(stdout);
    } else {
      if (existsSync(clonePath)) {
        await execAsync(`rm -rf "${clonePath}"`);
      }
      console.log(`📥 Cloning ${gitRepoUrl} into ${clonePath}...`);
      await execAsync(`git clone "${gitRepoUrl}" "${clonePath}"`, {
        maxBuffer: 10 * 1024 * 1024,
      });
    }

    console.log('📦 Installing dependencies...');
    await execAsync('bun install', { cwd: clonePath, maxBuffer: 10 * 1024 * 1024 });

    console.log('🔨 Building worker package...');
    const { stdout: buildStdout, stderr: buildStderr } = await execAsync('bun run build', {
      cwd: clonePath,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (buildStderr) console.warn('⚠️ Build warnings:', buildStderr);
    if (buildStdout) console.log(buildStdout);

    const entryPath = join(clonePath, 'dist', 'cli.js');
    if (!existsSync(entryPath)) {
      throw new Error(`Build output not found at ${entryPath}`);
    }
    console.log('✅ Repo update completed');
  } catch (error) {
    console.error('❌ Repo update failed:', error);
    throw error;
  }
}

/**
 * Restart by running the worker from the cloned directory with same argv and env.
 */
function restartProcessFromClone(clonePath: string): void {
  console.log('🔄 Restarting worker process from clone...');
  const entryPath = join(clonePath, 'dist', 'cli.js');
  const args = process.argv.slice(2);
  const child = spawn('bun', [entryPath, ...args], {
    cwd: clonePath,
    env: process.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  setTimeout(() => process.exit(0), 1000);
}

/**
 * Perform manual update using a custom command
 */
async function updateViaManual(command: string): Promise<void> {
  try {
    console.log('📥 Running update command...');
    console.log(`Command: ${command}`);

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    } as any);

    if (stdout) {
      console.log(stdout);
    }

    if (stderr) {
      console.warn('⚠️ Update command warnings:', stderr);
    }

    console.log('✅ Update command completed');
  } catch (error) {
    console.error('❌ Manual update failed:', error);
    throw error;
  }
}

/**
 * Restart the current process
 */
export async function restartProcess(): Promise<void> {
  console.log('🔄 Restarting worker process...');

  // Get the current script path
  const scriptPath = process.argv[1];

  // Restart using the same command
  const args = process.argv.slice(2);

  // Use exec to start a new process and exit current one
  // Detach the process so it continues after this one exits
  const child = exec(`bun ${scriptPath} ${args.join(' ')}`, {
    detached: true,
    stdio: 'ignore'
  } as any);

  // Unref the child process so the parent can exit
  child.unref();

  // Give the new process a moment to start
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Exit current process
  process.exit(0);
}

/**
 * Perform worker update
 */
export async function performUpdate(options: UpdateOptions = {}): Promise<void> {
  const {
    method = 'server',
    gitPath = process.cwd(),
    serverUrl,
    gitRepoUrl,
    clonePath = DEFAULT_CLONE_PATH,
    restartAfterUpdate = true,
    updateCommand,
  } = options;

  try {
    console.log('🚀 Starting worker update...');
    console.log(`Current version: ${getWorkerVersion()}`);
    console.log(`Update method: ${method}`);

    if (method === 'repo') {
      if (!gitRepoUrl) {
        throw new Error('gitRepoUrl is required for repo update method');
      }
      await updateViaRepo(gitRepoUrl, clonePath);
      if (options.onUpdateComplete) {
        try {
          await options.onUpdateComplete();
        } catch (error) {
          console.warn('⚠️ onUpdateComplete callback failed:', error);
        }
      }
      if (restartAfterUpdate) {
        restartProcessFromClone(clonePath);
      }
      return;
    }

    if (method === 'git') {
      // Check if we're in a git repository
      if (!isGitRepository(gitPath)) {
        throw new Error(`Not a git repository: ${gitPath}`);
      }

      await updateViaGit(gitPath);
    } else if (method === 'server') {
      if (!serverUrl) {
        throw new Error('serverUrl is required for server update method');
      }

      // Determine worker path (try to find packages/worker or use current dir)
      let workerPath = process.cwd();
      const possibleWorkerPaths = [
        join(process.cwd(), 'packages/worker'),
        process.cwd(),
      ];

      for (const path of possibleWorkerPaths) {
        if (existsSync(join(path, 'package.json'))) {
          workerPath = path;
          break;
        }
      }

      await updateViaServer(serverUrl, workerPath);
    } else if (method === 'manual') {
      if (!updateCommand) {
        throw new Error('updateCommand is required for manual update method');
      }

      await updateViaManual(updateCommand);
    } else {
      throw new Error(`Unknown update method: ${method}`);
    }

    // Verify the update
    const newVersion = getWorkerVersion();
    console.log(`✅ Update completed. New version: ${newVersion}`);

    // Call onUpdateComplete callback if provided (e.g., to update last update date)
    if (options.onUpdateComplete) {
      try {
        await options.onUpdateComplete();
      } catch (error) {
        console.warn('⚠️ onUpdateComplete callback failed:', error);
      }
    }

    if (restartAfterUpdate) {
      await restartProcess();
    }
  } catch (error) {
    console.error('❌ Update failed:', error);
    throw error;
  }
}

