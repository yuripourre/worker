import type {
  Device,
  Job,
  JobResult,
  ResourceUsage,
  RegisterDeviceRequest,
  WorkerConfig,
  WorkerOptions,
  Capability
} from './types';
import { type ArtifactMetadata, EXTERNAL_SERVICES_CONFIG } from './shared';
import { SpecsAnalyzer, type CurrentResourceUsage } from './utils/specs-analyzer';
import { ResourceService } from './services/resource-service';
import { ExecutorConfig, ExecutableJob, ExecutableJobResult } from './execution/types';
import { Executor } from './execution/executor/executor';
import { LLMClient } from './execution/llm-client';
import { WORKER_CONFIG } from './config/constants';
import { networkInterfaces } from 'os';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { LocalServer, LocalServerConfig } from './local-server';
import { getWorkerVersion } from './utils/version-utils';
import { collectToolInventory } from './utils/tool-inventory-collector';

/**
 * Executor Client - A simple client for worker services that execute jobs
 *
 * This client abstracts all executor-related API operations and can be easily
 * embedded in worker services that need to execute jobs and report status.
 */
export class Worker {
  private config: WorkerConfig;
  private options: Required<WorkerOptions>;
  private fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  private isRegistered: boolean = false;
  private workerId?: string;
  private specsAnalyzer: SpecsAnalyzer;
  private resourceService: ResourceService;
  private executor?: Executor;
  private localServer?: LocalServer;

  // Connection state tracking
  private isServerConnected: boolean = true;
  private consecutiveConnectionFailures: number = 0;
  private reconnectCheckInterval?: NodeJS.Timeout;
  private onReconnectCallback?: () => Promise<void>;

  // Capability checking state (used when sending payload with registerForJob)
  private jobPollCount: number = 0;
  private readonly CAPABILITY_CHECK_INTERVAL = 6; // Check capabilities every 6 polls

  // Model inventory state — sent with every registerForJob heartbeat when changed
  private currentModelInventory: import('./shared').ModelInventory | undefined;
  private currentModelTags: string[] = [];
  private lastSentModelInventoryJson: string | undefined;
  private lastSentModelTagsJson: string | undefined;

  // Tool inventory state — sent with every registerForJob heartbeat when changed
  private currentToolInventory: import('./shared').WorkerToolInventory | undefined;
  private lastSentToolInventoryJson: string | undefined;

  // Optional: called when building heartbeat to get fresh model inventory/tags (CLI sets this)
  private getCurrentModelInventoryAndTags?: () => Promise<{
    modelInventory?: import('./shared').ModelInventory;
    tags?: string[];
  }>;

  // Version tracking
  private readonly workerVersion: string;
  private updatePending: boolean = false;
  private updateCallback?: () => Promise<void>;

  // Base API path for all endpoints
  private readonly API_BASE = '/api';
  private readonly CONFIG_FILE_PATH = './worker-config.json';
  private readonly RECONNECT_CHECK_INTERVAL_MS = 10000; // Check every 10 seconds
  private readonly MAX_CONSECUTIVE_FAILURES = 3; // After 3 failures, consider disconnected

  constructor(config: WorkerConfig, options: Partial<WorkerOptions> = {}) {
    // Load saved config from disk and merge with provided config
    const savedConfig = this.loadWorkerConfig();
    const baseUrl = (config.baseUrl ?? '').replace(/\/+$/, '');
    this.config = {
      ...config,
      baseUrl,
      // Override with saved values if they exist (deviceId, workerId, deviceName, etc.)
      ...(savedConfig?.deviceId && { deviceId: savedConfig.deviceId }),
      ...(savedConfig?.workerId && { workerId: savedConfig.workerId }),
      ...(savedConfig?.deviceName && { deviceName: savedConfig.deviceName }),
      ...(savedConfig?.comfyuiPath && { comfyuiPath: savedConfig.comfyuiPath }),
      ...(savedConfig?.ollamaBaseUrl && { ollamaBaseUrl: savedConfig.ollamaBaseUrl }),
    };

    // Restore workerId if it was saved
    if (savedConfig?.workerId) {
      this.workerId = savedConfig.workerId;
    }
    this.options = {
      autoRegister: options.autoRegister ?? false,
      retryAttempts: options.retryAttempts ?? WORKER_CONFIG.DEFAULT_RETRY_ATTEMPTS,
      retryDelay: options.retryDelay ?? WORKER_CONFIG.DEFAULT_RETRY_DELAY_MS,
      logLevel: options.logLevel ?? WORKER_CONFIG.DEFAULT_LOG_LEVEL
    };

    // Use global fetch or node-fetch if available
    this.fetch = globalThis.fetch || (() => {
      throw new Error('Fetch is not available. Please install node-fetch or use a modern Node.js version.');
    });

    // Initialize specs analyzer for system monitoring
    this.specsAnalyzer = new SpecsAnalyzer();
    this.resourceService = new ResourceService();

    // Get worker version
    this.workerVersion = getWorkerVersion();
    this.log('info', `Worker version: ${this.workerVersion}`);

    // Load persisted config from file (deviceId, workerId, deviceName, comfyuiPath, ollamaBaseUrl)
    const persistedConfig = this.loadWorkerConfig();
    if (persistedConfig?.deviceId && !this.config.deviceId) {
      this.config.deviceId = persistedConfig.deviceId;
      this.log('info', `Loaded deviceId from config: ${persistedConfig.deviceId}`);
    }
    if (persistedConfig?.workerId) {
      this.workerId = persistedConfig.workerId;
      this.log('info', `Loaded workerId from config: ${persistedConfig.workerId}`);
    }
    if (persistedConfig?.deviceName && !this.config.deviceName) {
      this.config.deviceName = persistedConfig.deviceName;
    }
    if (persistedConfig?.comfyuiPath && !this.config.comfyuiPath) {
      this.config.comfyuiPath = persistedConfig.comfyuiPath;
    }
    if (persistedConfig?.ollamaBaseUrl && !this.config.ollamaBaseUrl) {
      this.config.ollamaBaseUrl = persistedConfig.ollamaBaseUrl;
    }

    // LocalServer will be initialized later via initializeLocalServer() method

    // Auto-register if enabled
    if (this.options.autoRegister && !this.config.deviceId) {
      this.log('warn', 'Auto-register enabled but no deviceId provided. Please call registerDevice() first.');
    }
  }

  /**
   * Initialize the local server for file operations and terminal access
   */
  async initializeLocalServer(): Promise<void> {
    try {
      this.log('info', 'Initializing local server for file operations and terminal access');

      const localServerConfig: LocalServerConfig = {
        port: 51115, // Same port as WORKER_FILE_SERVER_PORT in frontend
        uploadDir: './uploads',
        comfyuiPath: this.config.comfyuiPath,
        ollamaBaseUrl: this.config.ollamaBaseUrl,
        // authToken is optional in LocalServerConfig
      };

      this.localServer = new LocalServer(localServerConfig);
      this.log('debug', 'LocalServer instance created');

      // Set up config update callback
      this.localServer.setConfigUpdateCallback((config) => {
        if (config.comfyuiPath) {
          this.setComfyUIPath(config.comfyuiPath);
        }
        if (config.ollamaBaseUrl) {
          this.setOllamaBaseUrl(config.ollamaBaseUrl);
        }
      });

      // Start the local server
      await this.localServer.start();
      this.log('info', 'Local server started successfully on port 51115');

      // Verify server is running
      const isRunning = this.localServer.isServerRunning();
      this.log('info', `Local server running status: ${isRunning}`);
    } catch (error) {
      this.log('error', `Failed to initialize local server: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Register this device with the cluster
   */
  async registerDevice(deviceData: RegisterDeviceRequest): Promise<Device> {
    try {
      this.log('info', `Registering device: ${deviceData.name}`);
      this.log('debug', `Device data: ${JSON.stringify(deviceData, null, 2)}`);

      const response = await this.makeRequest('/devices', {
        method: 'POST',
        body: JSON.stringify(deviceData)
      });

      this.config.deviceId = response.id;
      this.config.deviceName = deviceData.name;
      this.saveWorkerConfig({
        deviceId: response.id,
        deviceName: deviceData.name
      });
      this.isRegistered = true;

      this.log('info', `Device registered successfully: ${response.id}`);

      return response;
    } catch (error) {
      this.log('error', `Failed to register device: ${error instanceof Error ? error.message : 'Unknown error'}`);
      this.log('debug', `Full error details: ${JSON.stringify(error, null, 2)}`);
      throw error;
    }
  }

  /**
   * Update device fields (tags, modelInventory, etc.) on the server.
   */
  async updateDevice(deviceId: string, updates: Partial<Device>): Promise<void> {
    try {
      await this.makeRequest(`/devices/${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
    } catch (error) {
      this.log('warn', `Failed to update device: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get the local IP address of this worker
   * Uses the same logic as the server's getLocalNetworkIP function
   */
  private getLocalIpAddress(): string | undefined {
    try {
      const nets = networkInterfaces();

      // Look for the first non-internal IPv4 address (same logic as server)
      for (const name of Object.keys(nets)) {
        const netInfo = nets[name];
        if (!netInfo) continue;

        // Skip loopback interfaces
        if (name === 'lo' || name.includes('Loopback')) continue;

        for (const net of netInfo) {
          // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
          // Handle both string ('IPv4') and number (4) family values
          const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4;
          if (net.family === familyV4Value && !net.internal) {
            this.log('debug', `Found local IP address: ${net.address} on interface ${name}`);
            return net.address;
          }
        }
      }

      this.log('warn', 'No local IP address found (only loopback/internal interfaces available)');
      return undefined;
    } catch (error) {
      this.log('warn', `Failed to get local IP address: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return undefined;
    }
  }

  /**
   * Register this worker with the cluster
   */
  async registerWorker(): Promise<string> {
    if (!this.config.deviceId) {
      throw new Error('Device not registered. Call registerDevice() first.');
    }

    try {
      this.log('info', 'Registering worker');

      // Get local IP address
      const localIp = this.getLocalIpAddress();
      if (localIp) {
        this.log('info', `🌐 Using local IP address: ${localIp}`);
      } else {
        this.log('warn', '⚠️  No local IP address detected - worker may not be accessible from network');
      }

      const response = await this.makeRequest('/workers/register', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: this.config.deviceId,
          deviceName: this.config.deviceName || 'Unknown Device',
          ipAddress: localIp,
          workerId: this.workerId // Send existing workerId if we have one
        })
      });

      if (!response.workerId) {
        throw new Error('Server did not return worker ID');
      }

      this.workerId = response.workerId;
      // Save deviceId, workerId, and deviceName to config file
      this.saveWorkerConfig({
        deviceId: this.config.deviceId,
        workerId: this.workerId,
        deviceName: this.config.deviceName
      });
      this.log('info', `Worker registered successfully: ${this.workerId}`);

      // Heartbeat is sent with each job request (POST /api/jobs/register), not as a separate timer

      return this.workerId!;
    } catch (error) {
      this.log('error', `Failed to register worker: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Load worker config from disk
   */
  private loadWorkerConfig(): { deviceId?: string; workerId?: string; deviceName?: string; comfyuiPath?: string; ollamaBaseUrl?: string; lastUpdateDate?: string } | null {
    try {
      if (existsSync(this.CONFIG_FILE_PATH)) {
        const configContent = readFileSync(this.CONFIG_FILE_PATH, 'utf-8');
        const config = JSON.parse(configContent);
        return config;
      }
    } catch (error) {
      this.log('warn', `Failed to load worker config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    return null;
  }

  /**
   * Save worker config to disk
   */
  private saveWorkerConfig(config: { deviceId?: string; workerId?: string; deviceName?: string; comfyuiPath?: string; ollamaBaseUrl?: string; lastUpdateDate?: string }): void {
    try {
      const currentConfig = this.loadWorkerConfig() || {};
      const updatedConfig = { ...currentConfig, ...config };
      writeFileSync(this.CONFIG_FILE_PATH, JSON.stringify(updatedConfig, null, 2), 'utf-8');
      this.log('debug', `Saved worker config to ${this.CONFIG_FILE_PATH}`);
    } catch (error) {
      this.log('warn', `Failed to save worker config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get last update date
   */
  getLastUpdateDate(): string | undefined {
    const config = this.loadWorkerConfig();
    return config?.lastUpdateDate;
  }

  /**
   * Update last update date
   */
  updateLastUpdateDate(): void {
    const now = new Date().toISOString();
    this.saveWorkerConfig({ lastUpdateDate: now });
    this.log('info', `Last update date set to: ${now}`);
  }

  /**
   * Update ComfyUI path configuration
   */
  setComfyUIPath(path: string): void {
    this.config.comfyuiPath = path;
    this.saveWorkerConfig({ comfyuiPath: path });

    // Also update the LocalServer's config if it exists
    if (this.localServer) {
      (this.localServer as any).config.comfyuiPath = path;
    }

    if (this.executor && typeof (this.executor as any).updateComfyUIPath === 'function') {
      (this.executor as any).updateComfyUIPath(path);
      this.log('debug', 'Updated ComfyUI path in executor');
    }

    this.log('info', `ComfyUI path updated: ${path}`);
  }

  /**
   * Update Ollama base URL configuration
   */
  setOllamaBaseUrl(url: string): void {
    this.config.ollamaBaseUrl = url;
    this.saveWorkerConfig({ ollamaBaseUrl: url });

    // Also update the LocalServer's config if it exists
    if (this.localServer) {
      (this.localServer as any).config.ollamaBaseUrl = url;
    }

    if (this.executor && typeof (this.executor as any).updateOllamaBaseUrl === 'function') {
      (this.executor as any).updateOllamaBaseUrl(url);
      this.log('debug', 'Updated Ollama base URL in executor');
    }

    this.log('info', `Ollama base URL updated: ${url}`);
  }

  /**
   * Get current worker configuration
   */
  getWorkerConfig(): { deviceName?: string; comfyuiPath?: string; ollamaBaseUrl?: string } {
    return {
      deviceName: this.config.deviceName,
      comfyuiPath: this.config.comfyuiPath,
      ollamaBaseUrl: this.config.ollamaBaseUrl,
    };
  }

  /**
   * Check capabilities status periodically
   */
  private async checkCapabilitiesStatus(): Promise<Capability[] | undefined> {
    try {
      // Import the capability checker dynamically to avoid circular dependencies
      const { capabilityAvailabilityChecker } = await import('./utils/tool-availability-checker');
      const { registerAllCapabilityCheckers } = await import('./services/tool-checkers');

      // Register checkers with current config
      // Always register both - let the checkers themselves determine if services are available
      registerAllCapabilityCheckers(
        this.config.ollamaBaseUrl || EXTERNAL_SERVICES_CONFIG.DEFAULT_OLLAMA_BASE_URL,
        EXTERNAL_SERVICES_CONFIG.DEFAULT_COMFYUI_BASE_URL
      );

      // Check all capabilities
      const capabilityStatus = await capabilityAvailabilityChecker.getCapabilityStatus();

      this.log('debug', `Capability check: ${capabilityStatus.available.length} available, ${capabilityStatus.unavailable.length} unavailable`);

      // Return all capabilities (both available and unavailable)
      return [...capabilityStatus.available, ...capabilityStatus.unavailable];
    } catch (error) {
      this.log('warn', `Failed to check capabilities: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return undefined;
    }
  }

  /**
   * Update device usage/status
   */
  async updateDeviceUsage(usage: Partial<ResourceUsage>): Promise<void> {
    if (!this.config.deviceId) {
      throw new Error('Device not registered. Call registerDevice() first.');
    }

    try {
      this.log('debug', `Updating device usage: ${JSON.stringify(usage)}`);

      await this.makeRequest(`/devices/${encodeURIComponent(this.config.deviceId)}/usage`, {
        method: 'PUT',
        body: JSON.stringify(usage)
      });

      this.log('debug', 'Device usage updated successfully');
    } catch (error) {
      this.log('error', `Failed to update device usage: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Update the in-memory model inventory and tags that are included in every heartbeat.
   * Called from cli.ts after registration and after each periodic refresh.
   */
  setModelInventory(
    inventory: import('./shared').ModelInventory | undefined,
    tags: string[]
  ): void {
    this.currentModelInventory = inventory;
    this.currentModelTags = tags;
  }

  /**
   * Update the in-memory tool inventory that is included in every heartbeat.
   * Called from cli.ts on startup and after each WORKER_UPDATE tool install/remove.
   * Heartbeat also re-collects tools from disk when building payload, so this is for fallback/cache.
   */
  setToolInventory(inventory: import('./shared').WorkerToolInventory | undefined): void {
    this.currentToolInventory = inventory;
  }

  /**
   * Set callback to get current model inventory and tags when building heartbeat.
   * If set, we call it every time we build the payload and send only if changed.
   * CLI sets this so we always check for changes in LLM/ComfyUI models.
   */
  setInventoryRefreshCallback(
    getCurrentModelInventoryAndTags: () => Promise<{
      modelInventory?: import('./shared').ModelInventory;
      tags?: string[];
    }>
  ): void {
    this.getCurrentModelInventoryAndTags = getCurrentModelInventoryAndTags;
  }

  /**
   * Build payload (usage, capabilities, etc.) to send with registerForJob().
   */
  private async buildHeartbeatPayload(): Promise<{
    cpuUsage?: number;
    memoryUsage?: number;
    diskUsage?: number;
    temperature?: number;
    powerConsumption?: string;
    ipAddress?: string;
    capabilities?: Capability[];
    version?: string;
    lastUpdateDate?: string;
    modelInventory?: import('./shared').ModelInventory;
    toolInventory?: import('./shared').WorkerToolInventory;
    tags?: string[];
  }> {
    const resourceUsage = await this.getCurrentSystemResources();
    const resourceUsageWithTemp: CurrentResourceUsage = this.specsAnalyzer.getCurrentResourceUsage();
    const powerConsumption = this.specsAnalyzer.getPowerConsumption();
    const localIp = this.getLocalIpAddress();
    this.jobPollCount++;
    let capabilities: Capability[] | undefined;
    if (this.jobPollCount === 1 || this.jobPollCount % this.CAPABILITY_CHECK_INTERVAL === 0) {
      capabilities = await this.checkCapabilitiesStatus();
    }
    const lastUpdateDate = this.getLastUpdateDate();

    // Always check current model inventory/tags (from callback if set, else in-memory)
    let currentModelInventory = this.currentModelInventory;
    let currentTags = this.currentModelTags;
    if (this.getCurrentModelInventoryAndTags) {
      try {
        const fresh = await this.getCurrentModelInventoryAndTags();
        if (fresh.modelInventory !== undefined) currentModelInventory = fresh.modelInventory;
        if (fresh.tags !== undefined) currentTags = fresh.tags;
      } catch {
        // Keep existing in-memory values on error
      }
    }
    const currentInventoryJson =
      currentModelInventory !== undefined ? JSON.stringify(currentModelInventory) : undefined;
    const currentTagsJson = currentTags.length > 0 ? JSON.stringify(currentTags) : undefined;
    const includeModelInventory =
      currentInventoryJson !== undefined && currentInventoryJson !== this.lastSentModelInventoryJson;
    const includeTags =
      currentTagsJson !== undefined && currentTagsJson !== this.lastSentModelTagsJson;

    // Always check current tool inventory from disk; send only if changed
    const freshToolInventory = collectToolInventory();
    const currentToolInventoryJson = JSON.stringify(freshToolInventory);
    const includeToolInventory = currentToolInventoryJson !== this.lastSentToolInventoryJson;

    return {
      ...resourceUsage,
      temperature: resourceUsageWithTemp.temperature,
      powerConsumption,
      ipAddress: localIp,
      capabilities,
      version: this.workerVersion,
      lastUpdateDate,
      ...(includeModelInventory && currentModelInventory !== undefined && { modelInventory: currentModelInventory }),
      ...(includeTags && currentTags.length > 0 && { tags: currentTags }),
      ...(includeToolInventory && { toolInventory: freshToolInventory }),
    };
  }

  /**
   * Register for a job: long-poll until one is available (up to 30s server-side wait).
   * POSTs deviceId, workerId, and heartbeat data so the server treats the request as heartbeat.
   * Returns the job if one became available, or null on timeout (204).
   */
  async registerForJob(): Promise<Job | null> {
    if (!this.config.deviceId) {
      throw new Error('Device not registered. Call registerDevice() first.');
    }
    if (!this.workerId) {
      throw new Error('Worker not registered. Call registerWorker() first.');
    }

    const heartbeatData = await this.buildHeartbeatPayload();
    const body = {
      deviceId: this.config.deviceId,
      workerId: this.workerId,
      ...heartbeatData,
    };

    const url = `${this.config.baseUrl}${this.API_BASE}/jobs/register`;
    const response = await this.fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35_000), // 5s buffer over 30s server timeout
    });
    if (response.status === 204 || response.status === 200) {
      if (heartbeatData.modelInventory !== undefined) {
        this.lastSentModelInventoryJson = JSON.stringify(heartbeatData.modelInventory);
      }
      if (heartbeatData.tags !== undefined) {
        this.lastSentModelTagsJson = JSON.stringify(heartbeatData.tags);
      }
      if (heartbeatData.toolInventory !== undefined) {
        this.lastSentToolInventoryJson = JSON.stringify(heartbeatData.toolInventory);
      }
    }
    if (response.status === 204) return null;
    if (response.status === 200) return response.json() as Promise<Job>;
    const errorText = await response.text().catch(() => '');
    throw new Error(`Unexpected status ${response.status}${errorText ? ': ' + errorText : ''}`);
  }

  /**
   * @deprecated Use registerForJob() instead.
   */
  async waitForNextJob(): Promise<Job | null> {
    return this.registerForJob();
  }

  /**
   * Upload artifact file to server
   */
  async uploadArtifact(jobId: string, filePath: string, fileName: string): Promise<void> {
    if (!this.config.deviceId) {
      throw new Error('Device not registered. Call registerDevice() first.');
    }

    try {
      this.log('info', `Uploading artifact for job ${jobId}: ${fileName}`);

      // Read file
      const file = Bun.file(filePath);
      if (!await file.exists()) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Create FormData
      const formData = new FormData();
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'application/octet-stream' });
      formData.append('file', blob, fileName);

      // Upload to server
      const response = await this.fetch(`${this.config.baseUrl}/api/jobs/${encodeURIComponent(jobId)}/artifacts`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      this.log('info', `Artifact uploaded successfully: ${fileName}`);
    } catch (error) {
      this.log('error', `Failed to upload artifact ${fileName} for job ${jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Download artifact file from server
   */
  async downloadArtifact(jobId: string, fileName: string, targetPath: string): Promise<void> {
    if (!this.config.deviceId) {
      throw new Error('Device not registered. Call registerDevice() first.');
    }

    try {
      this.log('info', `Downloading artifact for job ${jobId}: ${fileName}`);

      const response = await this.fetch(`${this.config.baseUrl}/api/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(fileName)}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Artifact not found: ${fileName}`);
        }
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      // Get file buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Write file
      await Bun.write(targetPath, buffer);

      this.log('info', `Artifact downloaded successfully: ${fileName} -> ${targetPath}`);
    } catch (error) {
      this.log('error', `Failed to download artifact ${fileName} for job ${jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * List artifacts for a job
   */
  async listArtifacts(jobId: string): Promise<Array<{ fileName: string; fileSize: number }>> {
    try {
      const response = await this.makeRequest(`/jobs/${encodeURIComponent(jobId)}/artifacts`, {
        method: 'GET',
      });

      return response.artifacts || [];
    } catch (error) {
      this.log('error', `Failed to list artifacts for job ${jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * Submit job result/answer and upload artifacts
   */
  async submitJobResult(jobId: string, result: Omit<JobResult, 'completedAt'>, appId?: string): Promise<void> {
    if (!this.config.deviceId) {
      throw new Error('Device not registered. Call registerDevice() first.');
    }

    try {
      this.log('info', `Submitting result for job: ${jobId}`);

      // Upload artifacts if any
      if (result.artifacts && result.artifacts.length > 0) {
        for (const artifact of result.artifacts) {
          // Upload the file if it exists locally
          if (artifact.filePath) {
            try {
              await this.uploadArtifact(jobId, artifact.filePath, artifact.fileName);
            } catch (error) {
              this.log('warn', `Failed to upload artifact ${artifact.fileName}, continuing: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }
        }
      }

      // Submit result (include appId so server updates the correct app's job)
      const body = { ...result, ...(appId && { appId }) };
      await this.makeRequest(`/jobs/${encodeURIComponent(jobId)}/answer`, {
        method: 'POST',
        body: JSON.stringify(body)
      });

      this.log('info', `Job result submitted successfully: ${jobId}`);
    } catch (error) {
      this.log('error', `Failed to submit job result ${jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Update job status outputs
   */
  async updateJobStatusOutputs(jobId: string, statusOutputs: any[]): Promise<void> {
    if (!this.config.deviceId) {
      throw new Error('Device not registered. Call registerDevice() first.');
    }

    try {
      this.log('info', `Updating status outputs for job: ${jobId}`);

      await this.makeRequest(`/jobs/${encodeURIComponent(jobId)}/status-outputs`, {
        method: 'PUT',
        body: JSON.stringify({ statusOutputs })
      });

      this.log('info', `Job status outputs updated successfully: ${jobId}`);
    } catch (error) {
      this.log('error', `Failed to update job status outputs ${jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Reserve a specific job by ID
   */
  async reserveJob(jobId: string): Promise<Job | null> {
    if (!this.workerId) {
      throw new Error('Worker not registered. Call registerWorker() first.');
    }

    try {
      this.log('info', `Reserving job: ${jobId}`);

      const reservedJob = await this.makeRequest(`/jobs/${encodeURIComponent(jobId)}/reserve`, {
        method: 'POST',
        body: JSON.stringify({ workerId: this.workerId })
      });

      this.log('info', `Job reserved successfully: ${jobId}`);
      return reservedJob;
    } catch (error) {
      if (error instanceof Error && error.message.includes('HTTP 409')) {
        this.log('warn', `Job ${jobId} is not available for reservation`);
        return null;
      }

      this.log('error', `Failed to reserve job ${jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Start processing a reserved job
   */
  async startReservedJob(jobId: string): Promise<Job | null> {
    if (!this.workerId) {
      throw new Error('Worker not registered. Call registerWorker() first.');
    }

    try {
      this.log('info', `Starting reserved job: ${jobId}`);

      const startedJob = await this.makeRequest(`/jobs/${encodeURIComponent(jobId)}/start`, {
        method: 'POST',
        body: JSON.stringify({ workerId: this.workerId })
      });

      this.log('info', `Job started successfully: ${jobId}`);
      return startedJob;
    } catch (error) {
      if (error instanceof Error && error.message.includes('HTTP 409')) {
        this.log('warn', `Job ${jobId} is not available to start`);
        return null;
      }

      this.log('error', `Failed to start job ${jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Mark job as failed (optional appId so server updates the correct app's job in middleware)
   */
  async markJobFailed(jobId: string, error: string, appId?: string): Promise<void> {
    if (!this.config.deviceId) {
      throw new Error('Device not registered. Call registerDevice() first.');
    }

    try {
      this.log('warn', `Marking job as failed: ${jobId} - ${error}`);

      const body = { error, ...(appId && { appId }) };
      await this.makeRequest(`/jobs/${encodeURIComponent(jobId)}/fail`, {
        method: 'POST',
        body: JSON.stringify(body)
      });

      this.log('info', `Job marked as failed: ${jobId}`);
    } catch (err) {
      this.log('error', `Failed to mark job as failed ${jobId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      throw err;
    }
  }

  /**
   * Release a reserved job back to pending status so other workers can pick it up
   */
  async releaseJob(jobId: string, reason: string): Promise<void> {
    if (!this.workerId) {
      throw new Error('Worker not registered. Call registerWorker() first.');
    }

    try {
      this.log('warn', `Releasing job: ${jobId} - ${reason}`);

      await this.makeRequest(`/jobs/${encodeURIComponent(jobId)}/release`, {
        method: 'POST',
        body: JSON.stringify({
          workerId: this.workerId,
          reason
        })
      });

      this.log('info', `Job released successfully: ${jobId}`);
    } catch (err) {
      this.log('error', `Failed to release job ${jobId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      throw err;
    }
  }


  /**
   * Get current device information
   */
  async getDeviceInfo(): Promise<Device | null> {
    if (!this.config.deviceId) {
      return null;
    }

    try {
      const devices = await this.makeRequest('/devices');
      return devices.find((d: Device) => d.id === this.config.deviceId) || null;
    } catch (error) {
      this.log('error', `Failed to get device info: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Get current system resources using ResourceService
   */
  private async getCurrentSystemResources(): Promise<ResourceUsage> {
    try {
      return await this.resourceService.getCurrentResources();
    } catch (error) {
      this.log('warn', `Failed to get system resources: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Fallback to basic values
      return {
        cpuUsage: 0,
        memoryUsage: 0,
        diskUsage: 0
      };
    }
  }



  /**
   * Set system resource getter function
   */
  setResourceGetter(getter: () => Promise<ResourceUsage> | ResourceUsage): void {
    this.getCurrentSystemResources = async () => {
      const result = getter();
      return result instanceof Promise ? result : Promise.resolve(result);
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    try {
      const response = await this.makeRequest('/health');
      return response;
    } catch (error) {
      this.log('error', `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Set up the executor (no engine; worker runs jobs directly via Executor).
   */
  setupExecutor(llmClient: LLMClient): void {
    this.executor = new Executor(
      llmClient,
      this.config.baseUrl,
      this.config.deviceId,
      this.workerId,
      this.localServer,
      this.config.ollamaBaseUrl,
      this.config.comfyuiPath
    );
    this.log('info', 'Executor initialized');
  }

  /**
   * Execute a job using the configured executor (no engine).
   */
  async executeJob(
    job: ExecutableJob,
    onUpdate?: (updatedJob: ExecutableJob) => void
  ): Promise<ExecutableJobResult> {
    if (!this.executor) {
      throw new Error('Executor not initialized. Call setupExecutor() first.');
    }

    const inProgressJob: ExecutableJob = {
      ...job,
      status: 'in_progress',
      startTime: new Date().toISOString(),
      statusOutputs: [...(job.statusOutputs || []), {
        status: 'in_progress',
        timestamp: new Date().toISOString(),
        output: 'Job started',
      }],
    };
    if (onUpdate) onUpdate(inProgressJob);
    try {
      await this.updateJobStatusOutputs(job.id, inProgressJob.statusOutputs || []);
    } catch (err) {
      this.log('warn', `Failed to update status outputs for job ${job.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    try {
      const result = await this.executor.executeExecution(job);
      const status = result.status === 'failed' ? 'failed' : result.status === 'insufficient' ? 'insufficient' : 'completed';
      const completedJob: ExecutableJob = {
        ...job,
        status,
        startTime: inProgressJob.startTime,
        endTime: new Date().toISOString(),
        answer: result.answer,
        statusOutputs: [
          ...(inProgressJob.statusOutputs || []),
          { status, timestamp: new Date().toISOString(), output: result.answer, metadata: result.score != null ? { score: result.score } : undefined },
        ],
      };
      if (onUpdate) onUpdate(completedJob);
      try {
        await this.updateJobStatusOutputs(job.id, completedJob.statusOutputs || []);
      } catch (err) {
        this.log('warn', `Failed to update status outputs for job ${job.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedJob: ExecutableJob = {
        ...job,
        status: 'failed',
        startTime: inProgressJob.startTime,
        endTime: new Date().toISOString(),
        answer: `Job failed: ${errorMessage}`,
        statusOutputs: [
          ...(inProgressJob.statusOutputs || []),
          { status: 'failed', timestamp: new Date().toISOString(), output: errorMessage },
        ],
      };
      if (onUpdate) onUpdate(failedJob);
      try {
        await this.updateJobStatusOutputs(job.id, failedJob.statusOutputs || []);
      } catch (err) {
        this.log('warn', `Failed to update status outputs for job ${job.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
      return { status: 'failed', answer: `Job execution failed: ${errorMessage}` };
    }
  }

  /**
   * Get the local server instance
   */
  getLocalServer(): LocalServer | undefined {
    return this.localServer;
  }

  getExecutionEngineLLMClient(): any {
    return this.executor?.getLLMClient?.();
  }

  /**
   * Check if server is reachable
   */
  async checkServerConnectivity(): Promise<boolean> {
    try {
      const response = await this.fetch(`${this.config.baseUrl}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Start periodic reconnection check when disconnected
   */
  private startReconnectionCheck(): void {
    if (this.reconnectCheckInterval) {
      return; // Already running
    }

    this.log('info', `Starting reconnection check (checking every ${this.RECONNECT_CHECK_INTERVAL_MS / 1000} seconds)`);

    this.reconnectCheckInterval = setInterval(async () => {
      if (this.isServerConnected) {
        // Connection restored, stop checking
        this.stopReconnectionCheck();
        return;
      }

      try {
        const isConnected = await this.checkServerConnectivity();
        if (isConnected) {
          this.log('info', 'Server is reachable, attempting to reconnect...');
          await this.attemptReconnection();
        }
      } catch (error) {
        // Silently continue checking
      }
    }, this.RECONNECT_CHECK_INTERVAL_MS);
  }

  /**
   * Stop reconnection check
   */
  private stopReconnectionCheck(): void {
    if (this.reconnectCheckInterval) {
      clearInterval(this.reconnectCheckInterval);
      this.reconnectCheckInterval = undefined;
      this.log('debug', 'Reconnection check stopped');
    }
  }

  /**
   * Attempt to reconnect and re-register with the server
   */
  async attemptReconnection(): Promise<boolean> {
    try {
      // Check connectivity first
      const isConnected = await this.checkServerConnectivity();
      if (!isConnected) {
        return false;
      }

      // Try to re-register the worker
      this.log('info', 'Re-registering worker with server...');
      try {
        const newWorkerId = await this.registerWorker();
        this.log('info', `Worker re-registered successfully with ID: ${newWorkerId}`);
        this.isServerConnected = true;
        this.consecutiveConnectionFailures = 0;

        // Call reconnection callback if set
        if (this.onReconnectCallback) {
          await this.onReconnectCallback();
        }

        return true;
      } catch (error) {
        this.log('warn', `Failed to re-register worker: ${error instanceof Error ? error.message : 'Unknown error'}`);
        return false;
      }

      return true;
    } catch (error) {
      this.log('debug', `Reconnection attempt failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }

  /**
   * Set callback to be called when reconnection succeeds
   */
  setOnReconnectCallback(callback: () => Promise<void>): void {
    this.onReconnectCallback = callback;
  }

  /**
   * Set callback to be called when update is required
   */
  setOnUpdateCallback(callback: () => Promise<void>): void {
    this.updateCallback = callback;
  }

  /**
   * Get current worker version
   */
  getVersion(): string {
    return this.workerVersion;
  }

  /**
   * Check if update is pending
   */
  isUpdatePending(): boolean {
    return this.updatePending;
  }

  /**
   * Get the base URL of the server
   */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Get current connection status
   */
  isConnectedToServer(): boolean {
    return this.isServerConnected;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.stopReconnectionCheck();

    if (this.config.deviceId) {
      try {
        // Mark device as offline
        await this.updateDeviceUsage({});
        this.log('info', 'Device marked as offline');
      } catch (error) {
        this.log('warn', `Failed to mark device as offline: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Build standard request headers
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
      ...(this.config.deviceId && { 'X-Device-ID': this.config.deviceId }),
    };
  }

  /**
   * Make HTTP request with retry logic
   */
  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.config.baseUrl}${this.API_BASE}${endpoint}`;
    const requestOptions: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
        ...(this.config.deviceId && { 'X-Device-ID': this.config.deviceId }),
        ...options.headers
      },
      ...options
    };

    let lastError: Error;

    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt++) {
      try {
        const response = await this.fetch(url, requestOptions);

        // Check if response is successful (2xx status codes)
        if (response.status < 200 || response.status >= 300) {
          let errorMessage: string;
          let errorData: any;

          try {
            // Try to parse JSON error response
            const responseText = await response.text();
            this.log('debug', `Error response body: ${responseText}`);

            try {
              errorData = JSON.parse(responseText);
              errorMessage = errorData.error || errorData.message || errorData.detail || `HTTP ${response.status}`;
            } catch (jsonError) {
              // If JSON parsing fails, use the raw text
              errorMessage = responseText || `HTTP ${response.status}`;
            }
          } catch (textError) {
            // If we can't even read the response text, fall back to status
            errorMessage = `HTTP ${response.status}`;
          }

          // Log different status codes with appropriate log levels
          if (response.status === 404) {
            // Don't retry on 404
            const looksLikeHtml404 =
              typeof errorMessage === 'string' &&
              (errorMessage.includes('page could not be found') ||
                errorMessage.includes('NOT_FOUND') ||
                errorMessage.includes('<!'));
            if (looksLikeHtml404) {
              const hint = `API returned 404. Ensure baseUrl points to the job-server API (e.g. http://localhost:51111), not the frontend. On Vercel, IDs with "::" can cause routing 404s; use a self-hosted server if this persists. Current baseUrl: ${this.config.baseUrl}`;
              throw new Error(`${errorMessage.trim().slice(0, 80)} - ${hint}`);
            }
            throw new Error(errorMessage);
          } else if (response.status >= 500) {
            this.log('error', `Server error ${response.status}: ${errorMessage}`);
          } else {
            this.log('warn', `Request failed ${response.status}: ${errorMessage}`);
          }

          throw new Error(errorMessage);
        }

        return await response.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');

        if (attempt === this.options.retryAttempts) {
          break;
        }

        this.log('warn', `Request failed (attempt ${attempt}/${this.options.retryAttempts}), retrying in ${this.options.retryDelay}ms`);
        await new Promise(resolve => setTimeout(resolve, this.options.retryDelay));
      }
    }

    throw lastError!;
  }

  /**
   * Log message based on log level
   */
  private log(level: 'none' | 'error' | 'warn' | 'info' | 'debug', message: string): void {
    const levels = { none: 0, error: 1, warn: 2, info: 3, debug: 4 };
    const currentLevel = levels[this.options.logLevel];
    const messageLevel = levels[level];

    if (messageLevel <= currentLevel) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [ExecutorClient] [${level.toUpperCase()}] ${message}`);
    }
  }
}
