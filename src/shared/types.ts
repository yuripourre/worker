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

/**
 * Job categories determining execution strategy
 */
export enum JobCategory {
  LLM = 'llm',
  IMAGE_GENERATION = 'image_generation',
  FILE_REQUEST = 'file_request',
  SCRIPT = 'script',
  HTTP_REQUEST = 'http_request',
  IMAGE = 'image',
  INFORMATION_REQUEST = 'information_request',
  MODEL_MANAGEMENT = 'model_management',
  WORKER_UPDATE = 'worker_update',
}

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

/**
 * LLM-specific job context
 */
export interface LLMJobContext extends BaseJobContext {
  category: JobCategory.LLM;
  model: string;
  temperature: number;
  outputType?: OutputType;
  systemPrompt?: string;
  userPrompt?: string;
  toolsUrl?: string;
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
}

/**
 * Script execution job context
 */
export interface ScriptJobContext extends BaseJobContext {
  category: JobCategory.SCRIPT;
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
  category: JobCategory.FILE_REQUEST;
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
  category: JobCategory.IMAGE_GENERATION;
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
  category: JobCategory.HTTP_REQUEST;
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
  category: JobCategory.IMAGE;
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
  return context.category === JobCategory.LLM;
}

export function isScriptJobContext(
  context: JobContext
): context is ScriptJobContext {
  return context.category === JobCategory.SCRIPT;
}

export function isFileRequestJobContext(
  context: JobContext
): context is FileRequestJobContext {
  return context.category === JobCategory.FILE_REQUEST;
}

export function isImageGenerationJobContext(
  context: JobContext
): context is ImageGenerationJobContext {
  return context.category === JobCategory.IMAGE_GENERATION;
}

export function isHttpRequestJobContext(
  context: JobContext
): context is HttpRequestJobContext {
  return context.category === JobCategory.HTTP_REQUEST;
}

export function isImageJobContext(
  context: JobContext
): context is ImageJobContext {
  return context.category === JobCategory.IMAGE;
}

/**
 * Information request job context
 * Used to request workers to send back system information
 */
export interface InformationRequestJobContext extends BaseJobContext {
  category: JobCategory.INFORMATION_REQUEST;
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
  return context.category === JobCategory.INFORMATION_REQUEST;
}

/**
 * Model management job context
 * Used to install/remove models on workers
 */
export interface ModelManagementJobContext extends BaseJobContext {
  category: JobCategory.MODEL_MANAGEMENT;
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
  return context.category === JobCategory.MODEL_MANAGEMENT;
}

/**
 * Worker update job context
 * Used to trigger worker updates from the server
 * Worker will use its existing baseUrl to download the update package
 */
export interface WorkerUpdateJobContext extends BaseJobContext {
  category: JobCategory.WORKER_UPDATE;
}

export function isWorkerUpdateJobContext(
  context: JobContext
): context is WorkerUpdateJobContext {
  return context.category === JobCategory.WORKER_UPDATE;
}

// ============================================================================
// Job Types
// ============================================================================

/**
 * Job status values
 */
export type JobStatus =
  | 'pending'
  | 'reserved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'insufficient'
  | 'waiting'
  | 'in_progress'
  | 'claimed';

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
  category?: JobCategory;
  status: JobStatus;
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
  status: JobStatus;
  startTime?: string;
  endTime?: string;
  answer?: string;
  prompt?: string;
  statusOutputs?: StatusOutput[];
  category: JobCategory;
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
    description: string;
    endpoint: string;
    method: string;
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
}

/** Job priority for queue ordering (higher = served first) */
export type JobPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Request to create a new job
 */
export interface CreateJobRequest {
  context: JobContext;
  category?: JobCategory;
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

// ============================================================================
// Tool Definition Types
// ============================================================================

/**
 * Tool definition types for LangGraph dynamic tool integration
 * These types can be shared across client and worker modules
 */

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  parameters: ToolParameter[];
}

export interface ToolsDefinitionResponse {
  tools: ToolDefinition[];
}
