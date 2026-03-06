#!/usr/bin/env bun

import { Worker } from './worker';
import type { DeviceSpec, ResourceUsage, Job, JobContext } from './types';
import type { ArtifactMetadata } from './shared';
import type { WorkerUpdateJobContext } from './shared';
import { isLLMJobContext, isWorkerUpdateJobContext, JobCategory, WORKER_CONFIG, EXTERNAL_SERVICES_CONFIG, DEVICE_CONFIG, COMFYUI_CATEGORY_TAG_PREFIXES, MODEL_TAG_PREFIX } from './shared';
import { join } from 'path';
import { SpecsAnalyzer } from './utils/specs-analyzer';
import { hostname, platform, arch } from 'os';
import { ResourceService } from './services/resource-service';
import { LangGraphLLMClient } from './execution/langgraph-llm-client';
import { ExecutableJob } from './execution/types';
import { performUpdate, type UpdateOptions } from './utils/update-handler';

interface CLIOptions {
  baseUrl: string;
  deviceName?: string;
  logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaTemperature?: number;
  comfyuiBaseUrl?: string; // ComfyUI base URL
  singleRun?: boolean; // Run once and exit after job completion
  idle?: boolean; // Start in idle mode - register but don't process jobs
}

class ExecutorCLI {
  private client: Worker;
  private options: CLIOptions;
  private resourceService: ResourceService;
  private deviceId?: string;
  private isProcessingJob = false;
  private shuttingDown = false;

  // Update state
  private updateInProgress: boolean = false;
  private updatePending: boolean = false;

  // Model inventory refresh state
  private pollCount: number = 0;
  private lastModelInventoryJson: string = 'null';

  constructor(options: CLIOptions) {
    this.options = options;
    this.resourceService = new ResourceService();

    console.log('🤖 Initializing worker client...');
    this.client = new Worker(
      {
        baseUrl: options.baseUrl,
      },
      {
        logLevel: options.logLevel || 'info',
        autoRegister: false, // We'll handle registration manually
      }
    );
  }

  /**
   * Initialize the executor with async operations
   */
  async initialize(): Promise<void> {
    // Initialize the worker's local server
    console.log('🏗️ Initializing worker local server...');
    await this.client.initializeLocalServer();

    // Wait for the LocalServer to be ready
    console.log('⏳ Waiting for local server to initialize...');
    let retries = 0;
    const maxRetries = 10;

    while (retries < maxRetries) {
      try {
        // Try to connect to the local server health endpoint
        const response = await fetch('http://localhost:51115/health');
        if (response.ok) {
          console.log('✅ Local server is ready and responding');
          break;
        }
      } catch (error) {
        // Server not ready yet
      }

      retries++;
      console.log(`⏳ Waiting for local server (${retries}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (retries >= maxRetries) {
      console.warn('⚠️ Local server may not be ready, but continuing...');
    }

    console.log('✅ Worker initialization completed');
    console.log('⚠️  Note: Executor will be initialized after device registration');
  }


  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Executor CLI...');

      // Check capabilities first
      await this.checkCapabilities();

      // Register device with real system specs
      await this.registerDevice();

      // Set up the executor AFTER registration (so deviceId is available)
      console.log('🔧 Setting up executor with device ID:', this.deviceId);
      const llmClient = new LangGraphLLMClient({
        baseUrl: this.options.ollamaBaseUrl || EXTERNAL_SERVICES_CONFIG.DEFAULT_OLLAMA_BASE_URL,
        defaultModel: this.options.ollamaModel || 'qwen3:1.7b',
        defaultTemperature: this.options.ollamaTemperature || 0.7,
        defaultMaxTokens: 2048
      });

      this.client.setupExecutor(llmClient);

      console.log(`   Ollama URL: ${llmClient.getBaseUrl()}`);
      console.log(`   Model: ${llmClient.getConfig().defaultModel}`);
      console.log(`   Temperature: ${llmClient.getConfig().defaultTemperature}`);

      const comfyuiBaseUrl = this.options.comfyuiBaseUrl || EXTERNAL_SERVICES_CONFIG.DEFAULT_COMFYUI_BASE_URL;
      const comfyuiUrl = new URL(comfyuiBaseUrl);
      const comfyuiModelsPath = (this.client as any).config?.comfyuiPath
        ? join((this.client as any).config.comfyuiPath, 'models')
        : process.env.COMFYUI_MODELS_PATH;
      console.log(`   ComfyUI URL: ${comfyuiBaseUrl}`);
      console.log(`   ComfyUI port: ${comfyuiUrl.port || (comfyuiUrl.protocol === 'https:' ? '443' : '80')}`);
      console.log(`   ComfyUI models folder: ${comfyuiModelsPath ?? '(not set)'}`);

      if (this.options.singleRun) {
        console.log('🔄 Single run mode enabled - will execute one job and exit');
        // Run once and exit
        await this.runSingleJob();
      } else if (this.options.idle) {
        console.log('😴 Idle mode enabled - worker registered but will not process jobs');
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
        console.log('✅ Executor CLI started in idle mode');
        console.log('⚠️  Worker is registered but will not request or process jobs (press Ctrl+C to exit)');
      } else {
        // Start the long-poll loop (heartbeat is sent with each registerForJob() call, no separate timer)
        this.startLongPollLoop();

        // Keep the process alive
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());

        console.log('✅ Executor CLI started successfully');
        console.log(`📡 Long-poll mode: waiting for jobs (heartbeat sent with each poll)`);
      }

    } catch (error) {
      console.error('❌ Failed to start Executor CLI:', error);
      process.exit(1);
    }
  }

  /**
   * Run a single job and exit (for single run mode)
   */
  private async runSingleJob(): Promise<void> {
    try {
      console.log('🔍 Requesting a single job...');

      await this.resourceService.getCurrentResources();
      const job = await this.client.registerForJob();

      if (job) {
        console.log(`📋 Job received: ${job.id}`);
        await this.processJob(job);
        console.log('✅ Job completed successfully');
      } else {
        console.log('😴 No jobs available');
      }

      console.log('🏁 Single run completed, exiting...');
      await this.shutdown();

    } catch (error) {
      console.error('❌ Error in single run mode:', error);
      await this.shutdown();
    }
  }

  private async checkCapabilities(): Promise<void> {
    // Capability checking removed - no longer needed without tools
  }

  private async registerDevice(): Promise<void> {
    try {
      console.log('🔧 Gathering system specifications...');

      const specs = await this.getSystemSpecs();

      // Check if worker has a persisted deviceName (from config file)
      // Use persisted name if no explicit --device-name was provided via CLI
      // The server will automatically reuse existing workers with the same name
      let deviceName: string;
      const persistedName = (this.client as any).config?.deviceName;

      if (this.options.deviceName) {
        // User explicitly provided a name via CLI argument
        deviceName = this.options.deviceName;
      } else if (persistedName) {
        // Use persisted name from config file
        deviceName = persistedName;
      } else {
        // Generate default name
        deviceName = `${hostname()}-${platform()}-${arch()}`;
      }

      // Get current system resource usage for registration
      const currentResources = await this.resourceService.getCurrentResources();

      // Get capabilities status (both available and unavailable)
      const { capabilityAvailabilityChecker } = await import('./utils/tool-availability-checker');
      const { registerAllCapabilityCheckers } = await import('./services/tool-checkers');

      // Register checkers with current config
      registerAllCapabilityCheckers(
        this.options.ollamaBaseUrl || EXTERNAL_SERVICES_CONFIG.DEFAULT_OLLAMA_BASE_URL,
        this.options.comfyuiBaseUrl || EXTERNAL_SERVICES_CONFIG.DEFAULT_COMFYUI_BASE_URL
      );

      const capabilityStatus = await capabilityAvailabilityChecker.getCapabilityStatus();

      // Collect model inventory
      console.log('📦 Collecting model inventory...');
      const { collectModelInventory } = await import('./utils/model-inventory-collector');
      const modelInventory = await collectModelInventory(
        this.options.ollamaBaseUrl,
        (this.client as any).config?.comfyuiPath
      );

      if (modelInventory) {
        console.log(`✅ Model inventory collected:`);
        if (modelInventory.ollamaModels) {
          console.log(`   - Ollama models: ${modelInventory.ollamaModels.length}`);
        }
        if (modelInventory.comfyuiModels) {
          const totalFiles = modelInventory.comfyuiModels.reduce((sum, cat) => sum + (cat.fileCount ?? cat.files?.length ?? 0), 0);
          const comfyuiModelsFolder = (this.client as any).config?.comfyuiPath
            ? join((this.client as any).config.comfyuiPath, 'models')
            : process.env.COMFYUI_MODELS_PATH;
          console.log(`   - ComfyUI models: ${totalFiles} files in ${modelInventory.comfyuiModels.length} categories`);
          console.log(`   - ComfyUI models folder: ${comfyuiModelsFolder ?? '(not set)'}`);
        }
      }

      const modelTags: string[] = [];
      for (const m of modelInventory?.ollamaModels ?? []) {
        modelTags.push(`${MODEL_TAG_PREFIX}${m.name}`);
      }
      for (const cat of modelInventory?.comfyuiModels ?? []) {
        const prefix = COMFYUI_CATEGORY_TAG_PREFIXES[cat.name] ?? MODEL_TAG_PREFIX;
        for (const f of cat.files ?? []) {
          modelTags.push(`${prefix}${f.name}`);
        }
      }
      this.lastModelInventoryJson = ExecutorCLI.inventoryForComparison(modelInventory) ?? 'null';
      this.client.setModelInventory(modelInventory, modelTags);

      const savedDeviceId = (this.client as any).config?.deviceId;
      const device = await this.client.registerDevice({
        ...(savedDeviceId && { deviceId: savedDeviceId }),
        name: deviceName,
        status: 'online',
        rating: 0, // New devices start with 0 rating
        jobExecutions: 0, // New devices start with 0 job executions
        cpuUsage: currentResources.cpuUsage, // Real-time CPU usage
        memoryUsage: currentResources.memoryUsage, // Real-time memory usage
        diskUsage: currentResources.diskUsage, // Real-time disk usage
        specs,
        // Include all capabilities (both available and unavailable) for complete status
        capabilities: [...capabilityStatus.available, ...capabilityStatus.unavailable],
        modelInventory,
        ...(modelTags.length > 0 && { tags: modelTags }),
      });

      this.deviceId = device.id;
      console.log(
        device.id === savedDeviceId
          ? `✅ Device reused with ID: ${this.deviceId}`
          : `✅ Device registered successfully with ID: ${this.deviceId}`
      );

      // Override the client's deviceId
      (this.client as any).config.deviceId = this.deviceId;

      // Now register the worker
      console.log('🤖 Registering worker...');
      const workerId = await this.client.registerWorker();
      console.log(`✅ Worker registered successfully with ID: ${workerId}`);

      // Set up reconnection callback to restart job loop when reconnected
      if (!this.options.singleRun && !this.options.idle) {
        this.client.setOnReconnectCallback(async () => {
          console.log('🔄 Reconnected to server, job loop will resume automatically');
          // Job loop will automatically resume on next interval
        });
      }

      // Set up update callback with baseUrl from client
      this.client.setOnUpdateCallback(async () => {
        await this.handleUpdate(this.client.getBaseUrl());
      });

    } catch (error) {
      console.error('❌ Failed to register device:', error);
      throw error;
    }
  }

  private async getSystemSpecs(): Promise<DeviceSpec> {
    const analyzer = new SpecsAnalyzer();
    const specs = analyzer.getSystemSpecs();

    // Convert the comprehensive specs to DeviceSpec format
    const primaryStorage = specs.storage[0] || { size: 'Unknown', used: 'Unknown', usePercent: 'N/A' };
    const primaryNetwork = specs.network[0] || { interface: 'Unknown', ip: 'Unknown' };
    const primaryGpu = specs.gpu && specs.gpu[0] ? specs.gpu[0].name : undefined;
    const primaryVram = specs.gpu && specs.gpu[0] ? specs.gpu[0].memory : undefined;
    const primaryGpuInfo = specs.gpu && specs.gpu[0] ? specs.gpu[0] : undefined;
    const primaryVramUsage = primaryGpuInfo && primaryGpuInfo.memoryUsed && primaryGpuInfo.memoryUsagePercent
      ? `${primaryGpuInfo.memoryUsed} / ${primaryGpuInfo.memory} (${primaryGpuInfo.memoryUsagePercent}%)`
      : primaryGpuInfo?.memoryUsed
      ? `${primaryGpuInfo.memoryUsed} / ${primaryGpuInfo.memory || 'Unknown'}`
      : undefined;

    // Try to get temperature from CPU info; clamp to server-allowed range
    let temperature = 0;
    if (specs.cpu.temperature && specs.cpu.temperature !== 'N/A') {
      const tempMatch = specs.cpu.temperature.match(/(\d+(?:\.\d+)?)/);
      if (tempMatch) {
        const raw = parseFloat(tempMatch[1]);
        temperature = Math.max(
          DEVICE_CONFIG.MIN_TEMPERATURE,
          Math.min(DEVICE_CONFIG.MAX_TEMPERATURE, raw)
        );
      }
    }

    // Get power consumption using the new method
    const powerConsumption = analyzer.getPowerConsumption();

    return {
      cpu: `${specs.cpu.model} (${specs.cpu.cores} cores, ${specs.cpu.speed} MHz)`,
      memory: `${specs.memory.used} / ${specs.memory.total} (${specs.memory.usagePercent}%)`,
      storage: `${primaryStorage.used} / ${primaryStorage.size} (${primaryStorage.usePercent || 'N/A'})`,
      gpu: primaryGpu,
      vram: primaryVram,
      vramUsage: primaryVramUsage,
      os: specs.system.osVersion || `${specs.system.platform} ${specs.system.release} (${specs.system.architecture})`,
      temperature,
      powerConsumption,
      networkInterface: `${primaryNetwork.interface} (${primaryNetwork.ip})`,
      location: 'Unknown', // Could be set via environment variable
    };
  }

  private readonly MODEL_INVENTORY_REFRESH_INTERVAL = 10;

  /** Strip volatile fields so comparison only considers model identity (names/counts), not timestamps. */
  private static inventoryForComparison(inventory: { lastUpdated?: string; ollamaModels?: Array<{ name: string; size: number; modified_at?: string; digest?: string }>; comfyuiModels?: Array<{ name: string; path: string; fileCount?: number; files?: Array<{ name: string; size: number; modified?: string; path: string }> }> } | null | undefined): string | null {
    if (!inventory) return null;
    const normalized = {
      ollamaModels: inventory.ollamaModels?.map(m => ({ name: m.name, size: m.size })),
      comfyuiModels: inventory.comfyuiModels?.map(cat => ({
        name: cat.name,
        path: cat.path,
        fileCount: cat.fileCount ?? cat.files?.length ?? 0,
        files: cat.files?.map(f => ({ name: f.name, size: f.size, path: f.path })),
      })),
    };
    return JSON.stringify(normalized);
  }

  private async refreshModelInventoryIfNeeded(): Promise<void> {
    if (this.pollCount % this.MODEL_INVENTORY_REFRESH_INTERVAL !== 0 || !this.deviceId) return;
    try {
      const { collectModelInventory } = await import('./utils/model-inventory-collector');
      const newInventory = await collectModelInventory(
        this.options.ollamaBaseUrl,
        (this.client as any).config?.comfyuiPath
      );
      const newJson = ExecutorCLI.inventoryForComparison(newInventory) ?? 'null';
      if (newJson === this.lastModelInventoryJson) return;

      const newTags: string[] = [];
      const ollamaCount = newInventory?.ollamaModels?.length ?? 0;
      for (const m of newInventory?.ollamaModels ?? []) {
        newTags.push(`${MODEL_TAG_PREFIX}${m.name}`);
      }
      let comfyuiFileCount = 0;
      for (const cat of newInventory?.comfyuiModels ?? []) {
        const prefix = COMFYUI_CATEGORY_TAG_PREFIXES[cat.name] ?? MODEL_TAG_PREFIX;
        for (const f of cat.files ?? []) {
          newTags.push(`${prefix}${f.name}`);
          comfyuiFileCount++;
        }
      }

      this.client.setModelInventory(newInventory, newTags);
      await this.client.updateDevice(this.deviceId, {
        tags: newTags,
        modelInventory: newInventory,
      });
      this.lastModelInventoryJson = newJson;
      console.log(
        `Model inventory updated: ${ollamaCount} Ollama + ${comfyuiFileCount} ComfyUI = ${newTags.length} model tags`
      );
    } catch (error) {
      console.warn(`Failed to refresh model inventory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private startLongPollLoop(): void {
    const loop = async () => {
      while (!this.shuttingDown) {
        if (this.isProcessingJob) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        if (!this.client.isConnectedToServer()) {
          console.log('⚠️  Server disconnected, retrying in 5s...');
          await new Promise(r => setTimeout(r, 5_000));
          continue;
        }

        try {
          this.pollCount++;
          await this.refreshModelInventoryIfNeeded();
          const job = await this.client.registerForJob();
          if (job) {
            console.log(`📋 Job received: ${job.id}`);
            await this.processJob(job);
          }
          // On 204 (timeout): reconnect immediately, no delay needed
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          const name = error instanceof Error ? (error as Error & { name?: string }).name : '';
          const isTimeout =
            name === 'TimeoutError' ||
            msg.includes('timed out') ||
            (typeof error === 'object' && error != null && (error as { code?: number }).code === 23);
          if (isTimeout) {
            console.log('⏱️  Long-poll timed out (no job yet), reconnecting...');
            await new Promise(r => setTimeout(r, WORKER_CONFIG.TIMEOUT_RECONNECT_DELAY_MS));
          } else if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
            console.log('⚠️  Server connection lost, retrying in 5s...');
            await new Promise(r => setTimeout(r, 5_000));
          } else {
            console.error('❌ Long-poll error:', error instanceof Error ? error.message : String(error));
            await new Promise(r => setTimeout(r, 2_000));
          }
        }
      }
    };
    loop().catch(err => console.error('Long-poll loop crashed:', err));
  }

  private async processJob(job: Job): Promise<void> {
    this.isProcessingJob = true;
    console.log(`⚡ Processing job: ${job.id}`);

    // Check if this is a worker update job
    if (job.category === JobCategory.WORKER_UPDATE || isWorkerUpdateJobContext(job.context)) {
      console.log('📦 Worker update job detected');

      // Mark job as completed
      try {
        await this.client.submitJobResult(job.id, {
          text: 'Worker update initiated',
          artifacts: [],
          rating: 5,
        }, (job as { appId?: string }).appId);
      } catch (error) {
        console.warn(`⚠️ Failed to mark update job as completed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Clear so handleUpdate does not defer (it checks isProcessingJob)
      this.isProcessingJob = false;
      await this.handleUpdate(this.client.getBaseUrl(), job.context as WorkerUpdateJobContext);
      return; // handleUpdate restarts the process
    }

    // --- Phase 1: Execute the job ---
    let result: { text: string; artifacts: ArtifactMetadata[]; rating?: number };
    try {
      result = await this.executeJob(job);
    } catch (execError) {
      const errorMessage = execError instanceof Error ? execError.message : 'Unknown error';
      console.error(`❌ Job execution failed: ${job.id}`, execError);
      try {
        await this.client.markJobFailed(job.id, errorMessage, (job as { appId?: string }).appId);
        console.log(`🔴 Job marked as failed: ${job.id}`);
      } catch (markError) {
        console.error('❌ Failed to mark job as failed:', markError);
      }
      this.isProcessingJob = false;
      return;
    }

    // --- Phase 2: Submit the result ---
    const jobResult = {
      text: result.text,
      artifacts: result.artifacts,
      rating: result.rating,
    };
    try {
      await this.client.submitJobResult(job.id, jobResult, (job as { appId?: string }).appId);
      console.log(`✅ Job completed successfully: ${job.id}`);

      this.isProcessingJob = false;
      console.log('🔄 Ready for new jobs');

      // Check if update was pending and trigger it now
      if (this.updatePending && !this.updateInProgress) {
        console.log('📦 Update was pending, triggering now...');
        this.updatePending = false;
        this.handleUpdate(this.client.getBaseUrl()).catch((error) => {
          console.error('❌ Failed to trigger pending update:', error);
        });
      }
    } catch (submitError) {
      // Submission failed — do NOT release back to pending (that causes a loop).
      // Mark as failed so the job stops cycling.
      console.error(`❌ Failed to submit result for job ${job.id}:`, submitError);
      try {
        await this.client.markJobFailed(job.id, submitError instanceof Error ? submitError.message : 'Unknown error', (job as { appId?: string }).appId);
        console.log(`🔴 Job marked as failed: ${job.id}`);
      } catch (markError) {
        console.error('❌ Failed to mark job as failed:', markError);
      }
      this.isProcessingJob = false;
    }
  }

  private async executeJob(job: Job): Promise<{ text: string; artifacts: ArtifactMetadata[]; rating?: number }> {
    console.log(`🔧 Executing job ${job.id}`);
    if (isLLMJobContext(job.context)) {
      console.log(`   Model: ${job.context.model}`);
      console.log(`   Temperature: ${job.context.temperature}`);
    }

    try {
      // Convert CLI Job to ExecutableJob format
      const executableJob = this.convertJobToExecutableJob(job);
      console.log(`📋 Converted job to executable format: ${executableJob.id}`);

      // Execute the job using the Worker's executor
      console.log(`🚀 Starting job execution for ${job.id}...`);
      const result = await this.client.executeJob(executableJob);

      console.log(`✅ Job execution completed: ${job.id}`);
      console.log(`   Status: ${result.status}`);
      console.log(`   Answer: ${result.answer.substring(0, 200)}${result.answer.length > 200 ? '...' : ''}`);

      // Check if the job execution failed
      if (result.status === 'failed' || result.status === 'insufficient') {
        console.error(`❌ Job execution ${result.status}: ${result.answer}`);
        throw new Error(`Job execution ${result.status}: ${result.answer}`);
      }

      // Convert the result to the expected format (ensure ArtifactMetadata shape)
      const artifacts: ArtifactMetadata[] = (result.artifacts || []).map((a) => ({
        fileName: a.fileName,
        filePath: a.filePath,
        workerId: a.workerId ?? 'unknown',
        workerIp: a.workerIp,
        fileSize: a.fileSize,
        checksum: a.checksum,
        mimeType: a.mimeType,
        createdAt: a.createdAt ?? new Date().toISOString(),
      }));
      return {
        text: result.answer,
        artifacts,
        rating: result.status === 'success' ? 5 : 1, // High rating for success, low for failure
      };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Execution failed: ${job.id}`, error);
      console.error(`   Error details:`, msg);
      throw error;
    }
  }

  /**
   * Convert server Job to ExecutableJob. Category is set by the server; no inference.
   */
  private convertJobToExecutableJob(job: Job): ExecutableJob {
    const category = job.category ?? (job.context && 'category' in job.context ? (job.context as { category: string }).category : undefined);
    if (category == null) {
      throw new Error('Job category is required (server must set category on every job)');
    }
    return {
      id: job.id,
      context: job.context,
      status: 'pending',
      category: category as ExecutableJob['category'],
    };
  }


  /**
   * Handle worker update
   */
  private async handleUpdate(baseUrl?: string, jobContext?: WorkerUpdateJobContext): Promise<void> {
    if (this.updateInProgress) {
      console.log('⏳ Update already in progress, skipping...');
      return;
    }

    // Don't update if we're processing a job
    if (this.isProcessingJob) {
      console.log('⏳ Job in progress, will update after completion...');
      this.updatePending = true;
      return;
    }

    this.updateInProgress = true;
    console.log('🚀 Starting worker update process...');

    try {
      const serverUrl = baseUrl || this.options.baseUrl;
      const onUpdateComplete = async () => {
        (this.client as any).updateLastUpdateDate();
      };

      // If job context has repoUrl, use repo method (clone/pull and run from there)
      if (jobContext?.repoUrl) {
        const updateOptions: UpdateOptions = {
          method: 'repo',
          gitRepoUrl: jobContext.repoUrl,
          clonePath: jobContext.clonePath,
          restartAfterUpdate: true,
          onUpdateComplete,
        };
        this.shuttingDown = true;
        await performUpdate(updateOptions);
        return;
      }

      // Otherwise use env-based method (server, git, or manual)
      const updateMethod = (process.env.WORKER_UPDATE_METHOD || 'server') as 'git' | 'server' | 'manual';
      const updateCommand = process.env.WORKER_UPDATE_COMMAND;
      const gitPath = process.env.WORKER_GIT_PATH || process.cwd();

      const updateOptions: UpdateOptions = {
        method: updateMethod,
        gitPath,
        serverUrl,
        restartAfterUpdate: true,
        updateCommand,
        onUpdateComplete,
      };

      // Signal the long-poll loop to stop
      this.shuttingDown = true;

      // Perform the update (this will restart the process)
      await performUpdate(updateOptions);
    } catch (error) {
      console.error('❌ Update failed:', error);
      this.updateInProgress = false;
      this.updatePending = false;
      this.shuttingDown = false;

      // Restart long-poll loop if update failed
      if (!this.options.singleRun && !this.options.idle) {
        this.startLongPollLoop();
      }
    }
  }

  private async shutdown(): Promise<void> {
    console.log('\n🛑 Shutting down Executor CLI...');

    this.shuttingDown = true;

    try {
      await this.client.cleanup();
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
    }

    process.exit(0);
  }
}

// CLI argument parsing
function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {
    baseUrl: 'http://localhost:51111',
    ollamaBaseUrl: EXTERNAL_SERVICES_CONFIG.DEFAULT_OLLAMA_BASE_URL,
    ollamaModel: 'qwen3:1.7b',
    ollamaTemperature: 0.7,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--base-url':
      case '-u':
        options.baseUrl = args[++i];
        break;

      case '--job-interval':
      case '-i':
        i++; // consume the value
        console.warn('⚠️  --job-interval / -i is deprecated and has no effect (long-poll mode is always used)');
        break;

      case '--device-name':
      case '-n':
        options.deviceName = args[++i];
        break;
      case '--log-level':
      case '-l':
        options.logLevel = args[++i] as any;
        break;
      case '--ollama-url':
      case '-o':
        options.ollamaBaseUrl = args[++i];
        break;
      case '--ollama-model':
      case '-m':
        options.ollamaModel = args[++i];
        break;
      case '--ollama-temperature':
      case '-t':
        options.ollamaTemperature = parseFloat(args[++i]) || 0.7;
        break;
      case '--comfyui-url':
      case '-c':
        options.comfyuiBaseUrl = args[++i];
        break;
      case '--single-run':
      case '-s':
        options.singleRun = true;
        break;
      case '--idle':
      case '-I':
        options.idle = true;
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;
      default:
        console.error(`❌ Unknown argument: ${arg}`);
        showHelp();
        process.exit(1);
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
🚀 Executor CLI - Job Execution Client

Usage: bun run cli.ts [options]

Options:
  -u, --base-url <url>        API base URL (default: http://localhost:51111)
  -n, --device-name <name>    Custom device name
  -l, --log-level <level>     Log level: none, error, warn, info, debug
  -o, --ollama-url <url>      Ollama base URL (default: http://localhost:11434)
  -m, --ollama-model <model>  Ollama model to use (default: qwen3:1.7b)
  -t, --ollama-temperature <n> Ollama temperature setting (default: 0.7)
  -c, --comfyui-url <url>     ComfyUI base URL (default: http://localhost:8188)
  -s, --single-run            Run once and exit after job completion
  -I, --idle                  Start in idle mode - register but don't process jobs
  -h, --help                  Show this help message
  -i, --job-interval <secs>   [DEPRECATED] No longer used; long-poll mode is always active

Examples:
  bun run cli.ts --base-url http://api.example.com
  bun run cli.ts -u http://localhost:8080
  bun run cli.ts --ollama-model llama3:8b --ollama-temperature 0.5
  bun run cli.ts --comfyui-url http://localhost:8188 --ollama-url http://localhost:11434
  bun run cli.ts --ollama-model llama3:8b
  bun run cli.ts --single-run
  bun run cli.ts --idle --device-name "Idle Worker"
  `);
}

// Main execution
async function main(): Promise<void> {
  try {
    const options = parseArgs();
    const cli = new ExecutorCLI(options);
    await cli.initialize();
    await cli.start();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module || process.argv[1] === __filename) {
  main();
}
