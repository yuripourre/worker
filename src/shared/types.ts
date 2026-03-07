/**
 * Simplified type definitions for the Job Server system
 * This package provides a single source of truth for all data models
 * used across the server, client, and frontend packages.
 */

// ============================================================================
// Core Entity Types
// ============================================================================

/**
 * Represents a capability that a device or worker can perform
 */
export interface Capability {
  name: string;
  available: boolean;
  version?: string;
  details?: string;
  error?: string;
}

/**
 * Device specifications including hardware details
 */
export interface DeviceSpec {
  cpu: string;
  memory: string;
  storage: string;
  gpu?: string;
  vram?: string;
  vramUsage?: string;
  os: string;
  temperature: number;
  powerConsumption: string;
  networkInterface: string;
  location: string;
}

/**
 * A tool installed on workers
 */
export interface WorkerTool {
  id: string;
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean';
    description: string;
    required: boolean;
    enum?: string[];
  }>;
  type: 'bash' | 'typescript' | 'binary' | 'zip';
  fileName: string;
  entryPoint?: string;
  version?: string;
  createdAt: string;
}

/**
 * Tool inventory reported by a worker in its heartbeat
 */
export interface WorkerToolInventory {
  lastUpdated?: string;
  tools?: Array<{ name: string; version?: string; type: string }>;
}

/**
 * Model inventory for a device
 */
export interface ModelInventory {
  lastUpdated?: string;
  ollamaModels?: Array<{
    name: string;
    size: number;
    modified_at?: string;
    digest?: string;
  }>;
  comfyuiModels?: Array<{
    name: string;
    path: string;
    fileCount?: number;
    files?: Array<{
      name: string;
      size: number;
      modified?: string;
      path: string;
    }>;
  }>;
}

/**
 * Represents a device/worker in the system
 */
export interface Device {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'warning';
  rating: number;
  jobExecutions: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  specs: DeviceSpec;
  lastUpdate: string;
  capabilities?: Capability[];
  ipAddress?: string;
  modelInventory?: ModelInventory;
  toolInventory?: WorkerToolInventory;
  /** Tags for capability routing (e.g. 'gpu-4090', 'ollama'); job requiredTags must be subset to claim */
  tags?: string[];
}

/**
 * Resource usage metrics
 */
export interface ResourceUsage {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
}

// ============================================================================
// Simplified Job Context Types
// ============================================================================

import { JobCategory as JobCategoryConst, type JobCategoryType } from './job-category.js';

export const JobCategory = JobCategoryConst;
export type { JobCategoryType };

/**
 * Base job context with common fields
 */
export interface BaseJobContext {
  requirements?: string;
  company?: string;
}

/**
 * Output type for job results
 */
export type OutputType = 'text' | 'image' | 'artifact';

/**
 * Think/reasoning level for Ollama (reasoning models)
 */
export type LLMThinkLevel = 'low' | 'medium' | 'high';

// ============================================================================
// MCP (Model Context Protocol) Types
// ============================================================================

export interface McpToolInputSchema {
  type: 'object';
  properties?: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    [key: string]: unknown;
  }>;
  required?: string[];
}

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  serverId: string;
  inputSchema: McpToolInputSchema;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
  _executeUrl: string;
}

export interface McpContent {
  type: 'text' | 'image' | 'audio' | 'resource_link' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

export interface McpToolResult {
  content: McpContent[];
  isError: boolean;
}

/** Tool definition for LLM jobs; worker executes the named tool locally as a subprocess. */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean';
    description: string;
    required: boolean;
    enum?: string[];
  }>;
  /** Execution type determines the runtime used by the worker. */
  type: 'bash' | 'typescript' | 'binary' | 'zip';
  /** For zip tools: relative path to the entry point inside the unpacked directory (e.g. "main.sh"). */
  entryPoint?: string;
}

/**
 * LLM-specific job context
 */
export interface LLMJobContext extends BaseJobContext {
  category: (typeof JobCategoryConst)['LLM'];
  model: string;
  temperature: number;
  outputType?: OutputType;
  systemPrompt?: string;
  userPrompt?: string;
  /** Tool definitions to make available to the LLM (worker calls tool endpoints on middleware API) */
  tools?: LLMToolDefinition[];
  image?: {
    fileName: string;
    mimeType: string;
    data: string; // Base64 encoded image data
  };
  /** Context window size (Ollama num_ctx) */
  numCtx?: number;
  /** Max tokens to generate (Ollama num_predict); -1 = infinite, -2 = fill context */
  numPredict?: number;
  /** Enable/level for reasoning (Ollama think) */
  think?: boolean | LLMThinkLevel;
  /** Sampling: top_p (0-1) */
  topP?: number;
  /** Sampling: top_k */
  topK?: number;
  /** Sampling: repeat_penalty */
  repeatPenalty?: number;
  /** Seed for reproducible outputs */
  seed?: number;
  /** Ollama structured output. Pass "json" to force valid JSON, or a JSON Schema object to enforce its shape. */
  format?: 'json' | Record<string, unknown>;
}

/**
 * Script execution job context
 */
export interface ScriptJobContext extends BaseJobContext {
  category: (typeof JobCategoryConst)['SCRIPT'];
  scriptContent: string;
  language: string;
  timeout?: number;
  workingDirectory?: string;
  environment?: Record<string, string>;
  dependencies?: string[];
  outputType?: OutputType;
  detached?: boolean; // If true, run process in background (detached)
  pidFile?: string; // Optional file path to store the process PID
}

/**
 * File request job context
 */
export interface FileRequestJobContext extends BaseJobContext {
  category: (typeof JobCategoryConst)['FILE_REQUEST'];
  requester: string;
  fileName: string;
}

/**
 * Image generation job context
 * Supports two modes:
 * 1. Traditional workflow mode: provide workflow JSON
 * 2. Queue mode: provide prompt (positive), negativePrompt (negative), seed, and optional promptId
 */
export interface ImageGenerationJobContext extends BaseJobContext {
  category: (typeof JobCategoryConst)['IMAGE_GENERATION'];
  prompt: string; // Used as "positive" prompt in queue mode
  negativePrompt?: string; // Used as "negative" prompt in queue mode
  seed?: number; // Seed for image generation
  workflow?: string; // Optional: traditional workflow JSON
  outputType?: OutputType;
  inputImages?: Array<{
    fileName: string;
    mimeType: string;
    data: string; // Base64 encoded image data
  }>;
  // Queue mode fields
  promptId?: string; // Optional: ComfyUI prompt_id to send to ComfyUI (can also be set after submission)
  queueMode?: boolean; // If true, use queue mode instead of workflow mode
}

/**
 * HTTP request job context
 */
export interface HttpRequestJobContext extends BaseJobContext {
  category: (typeof JobCategoryConst)['HTTP_REQUEST'];
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  timeout?: number;
  webhook?: string;
  outputType?: OutputType;
  image?: {
    fileName: string;
    mimeType: string;
    data: string; // Base64 encoded image data
  };
}

/**
 * Image processing job context
 */
export interface ImageJobContext extends BaseJobContext {
  category: (typeof JobCategoryConst)['IMAGE'];
  operation:
    | 'resize'
    | 'crop'
    | 'grayscale'
    | 'adjust_contrast'
    | 'upscale'
    | 'merge';
  outputType?: OutputType;
  image: {
    fileName: string;
    mimeType: string;
    data: string; // Base64 encoded image data
  };
  overlayImage?: {
    fileName: string;
    mimeType: string;
    data: string; // Base64 encoded image data for merge operation
  };
  parameters?: {
    // For resize/upscale
    width?: number;
    height?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
    quality?: number;
    format?: 'jpeg' | 'png' | 'webp' | 'avif';
    // For crop/merge
    x?: number;
    y?: number;
    // For contrast
    contrast?: number; // -100 to 100
  };
}

/**
 * Union type for all job contexts
 */
export type JobContext =
  | LLMJobContext
  | ScriptJobContext
  | FileRequestJobContext
  | ImageGenerationJobContext
  | HttpRequestJobContext
  | ImageJobContext
  | InformationRequestJobContext
  | ModelManagementJobContext
  | WorkerUpdateJobContext;

/**
 * Type guard functions for job contexts
 */
export function isLLMJobContext(context: JobContext): context is LLMJobContext {
  return context.category === JobCategoryConst.LLM;
}

export function isScriptJobContext(
  context: JobContext
): context is ScriptJobContext {
  return context.category === JobCategoryConst.SCRIPT;
}

export function isFileRequestJobContext(
  context: JobContext
): context is FileRequestJobContext {
  return context.category === JobCategoryConst.FILE_REQUEST;
}

export function isImageGenerationJobContext(
  context: JobContext
): context is ImageGenerationJobContext {
  return context.category === JobCategoryConst.IMAGE_GENERATION;
}

export function isHttpRequestJobContext(
  context: JobContext
): context is HttpRequestJobContext {
  return context.category === JobCategoryConst.HTTP_REQUEST;
}

export function isImageJobContext(
  context: JobContext
): context is ImageJobContext {
  return context.category === JobCategoryConst.IMAGE;
}

/**
 * Information request job context
 * Used to request workers to send back system information
 */
export interface InformationRequestJobContext extends BaseJobContext {
  category: (typeof JobCategoryConst)['INFORMATION_REQUEST'];
  informationType:
    | 'ollama_models'
    | 'comfyui_models'
    | 'all_models'
    | 'capabilities'
    | 'system_info';
  updateInventory?: boolean; // Whether to update the device inventory on the server
}

export function isInformationRequestJobContext(
  context: JobContext
): context is InformationRequestJobContext {
  return context.category === JobCategoryConst.INFORMATION_REQUEST;
}

/**
 * Model management job context
 * Used to install/remove models on workers
 */
export interface ModelManagementJobContext extends BaseJobContext {
  category: (typeof JobCategoryConst)['MODEL_MANAGEMENT'];
  operation: 'install' | 'remove' | 'update';
  service: 'ollama' | 'comfyui';
  modelName: string;
  modelUrl?: string; // For ComfyUI models or custom Ollama models
  targetPath?: string; // For ComfyUI models (e.g., 'checkpoints', 'loras', 'vae')
  updateInventory?: boolean; // Whether to update the device inventory after completion
}

export function isModelManagementJobContext(
  context: JobContext
): context is ModelManagementJobContext {
  return context.category === JobCategoryConst.MODEL_MANAGEMENT;
}

/**
 * Worker update job context
 * Used to trigger worker updates from the server
 * When repoUrl is set, worker clones/pulls that repo and restarts from it.
 */
export interface WorkerUpdateJobContext extends BaseJobContext {
  category: (typeof JobCategoryConst)['WORKER_UPDATE'];
  /** Git clone URL (e.g. https://github.com/yuripourre/worker.git). When set, worker uses repo update method. */
  repoUrl?: string;
  /** Target directory for clone; if omitted, worker uses a default path. */
  clonePath?: string;
  /** Install a specific tool on this worker; worker downloads the file from the server and unpacks/installs it. */
  toolInstall?: {
    toolId: string;
    toolName: string;
    type: 'bash' | 'typescript' | 'binary' | 'zip';
    fileName: string;
    entryPoint?: string;
    /** Optional command to run after extracting (e.g. "npm install", "./install.sh"). Runs with cwd = tool directory. */
    installCommand?: string;
  };
  /** Remove a previously installed tool from this worker. */
  toolRemove?: { toolName: string };
}

export function isWorkerUpdateJobContext(
  context: JobContext
): context is WorkerUpdateJobContext {
  return context.category === JobCategoryConst.WORKER_UPDATE;
}

// ============================================================================
// Job Types
// ============================================================================

import { JobStatus as JobStatusConst, type JobStatusType } from './job-status.js';

export const JobStatus = JobStatusConst;

/**
 * Status output for job progress tracking
 */
export interface StatusOutput {
  status: string;
  timestamp: string;
  output: string;
  metadata?: {
    score?: number;
  };
}

/**
 * Artifact metadata for file outputs
 */
export interface ArtifactMetadata {
  fileName: string;
  filePath: string; // Local path on worker where file was created
  workerId: string;
  workerIp?: string;
  fileSize: number;
  checksum?: string; // SHA-256 checksum
  mimeType?: string;
  createdAt: string;
}

/**
 * Job execution result
 */
export interface JobResult {
  text: string;
  artifacts: ArtifactMetadata[];
  rating?: number;
  completedAt: string;
  debugInfo?: LLMDebugInfo;
}

/**
 * Main job interface
 */
export interface Job {
  id: string;
  context: JobContext;
  category?: JobCategoryType;
  status: JobStatusType;
  assignedDeviceId?: string;
  assignedWorkerId?: string;
  workerId?: string;
  webhook?: string;
  createdAt: string;
  completedAt?: string;
  result?: JobResult;
  statusOutputs?: StatusOutput[];
  source?: 'local' | 'middleware'; // Track where the job came from
  middlewareJobId?: string; // Original job ID from middleware if applicable
  priority?: JobPriority;
  requiredTags?: string[];
  /** Short-lived token for MCP tool execution; set by server when returning job to worker. */
  toolCallToken?: string;
  /** Vercel Protection Bypass secret for MCP requests; set by server when configured. */
  vercelProtectionBypass?: string;
}

// ============================================================================
// Execution Engine Types
// ============================================================================

/**
 * Executable job for the execution engine
 */
export interface ExecutableJob {
  id: string;
  context: JobContext;
  status: JobStatusType;
  startTime?: string;
  endTime?: string;
  answer?: string;
  prompt?: string;
  statusOutputs?: StatusOutput[];
  category: JobCategoryType;
  /** Short-lived token for MCP tool execution; from job payload. */
  toolCallToken?: string;
  /** Vercel Protection Bypass secret for MCP requests; from job payload. */
  vercelProtectionBypass?: string;
}

/**
 * LLM Debug Information
 */
export interface LLMDebugInfo {
  systemPrompt?: string;
  userPrompt: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, any>;
    result?: string;
  }>;
  availableTools?: Array<{
    name: string;
    description?: string;
    type?: string;
  }>;
  messages?: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | any;
  }>;
  model: string;
  temperature: number;
}

/**
 * Result of job execution
 */
export interface ExecutableJobResult {
  status: 'success' | 'failed' | 'insufficient' | 'waiting';
  answer: string;
  score?: number;
  executionDetails?: Record<string, unknown>;
  artifacts?: Array<{
    fileName: string;
    filePath: string;
    workerId?: string;
    workerIp?: string;
    fileSize: number;
    checksum?: string;
    mimeType?: string;
    createdAt: string;
  }>;
}

/**
 * Minimal executor interface for execution engines.
 */
export interface IJobExecutor {
  executeExecution(job: ExecutableJob): Promise<ExecutableJobResult>;
}

/**
 * Configuration for the execution engine
 */
export interface ExecutorConfig {
  executor: IJobExecutor;
  toolClientConfig?: {
    type: 'hybrid' | 'remote' | 'local';
    baseUrl?: string;
    deviceId?: string;
    workerId?: string;
  };
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Standard error response shape for API errors
 */
export interface ErrorResponse {
  error: string;
  details?: string;
}

/**
 * Request to register a new device
 * When deviceId is provided and the device exists, the server updates it in place (reuse).
 */
export interface RegisterDeviceRequest {
  deviceId?: string;
  name: string;
  status: 'online' | 'offline' | 'warning';
  rating?: number;
  jobExecutions?: number;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
  specs: DeviceSpec;
  capabilities?: Capability[];
  modelInventory?: ModelInventory;
  toolInventory?: WorkerToolInventory;
}

/** Job priority for queue ordering (higher = served first) */
export type JobPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Request to create a new job
 */
export interface CreateJobRequest {
  context: JobContext;
  category?: JobCategoryType;
  webhook?: string;
  assignedDeviceId?: string; // Optional: assign job to a specific device/worker
  priority?: JobPriority;
  requiredTags?: string[]; // Optional: only workers whose device has all these tags can claim
}

/**
 * Job client configuration
 */
export interface JobClientConfig {
  baseUrl: string;
  apiKey?: string;
}

/**
 * Job client options
 */
export interface JobClientOptions {
  retryAttempts?: number;
  retryDelay?: number;
  logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Worker configuration
 */
export interface WorkerConfig {
  baseUrl: string;
  deviceId?: string;
  deviceName?: string;
  apiKey?: string;
  timeout?: number;
  comfyuiPath?: string;
  comfyuiBaseUrl?: string;
  ollamaBaseUrl?: string;
}

/**
 * Worker options
 */
export interface WorkerOptions {
  autoRegister?: boolean;
  retryAttempts?: number;
  retryDelay?: number;
  logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
}

