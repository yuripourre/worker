/**
 * Shared Configuration Constants
 * Single source of truth for all configuration values across the monorepo
 */

// ============================================================================
// Server Configuration
// ============================================================================

export const SERVER_CONFIG = {
  /**
   * Default server port
   */
  DEFAULT_PORT: 51111,

  /**
   * API base path
   */
  API_BASE_PATH: '/api',
} as const;

// ============================================================================
// External Services (Ollama, ComfyUI) – override via env OLLAMA_BASE_URL, COMFYUI_BASE_URL
// ============================================================================

export const EXTERNAL_SERVICES_CONFIG = {
  DEFAULT_OLLAMA_BASE_URL: 'http://localhost:11434',
  DEFAULT_COMFYUI_BASE_URL: 'http://localhost:8188',
} as const;

// ============================================================================
// Worker Configuration
// ============================================================================

export const WORKER_CONFIG = {
  /**
   * Default heartbeat interval in milliseconds (1 minute)
   */
  DEFAULT_HEARTBEAT_INTERVAL_MS: 60000,

  /**
   * Default retry attempts for failed operations
   */
  DEFAULT_RETRY_ATTEMPTS: 1,

  /**
   * Default delay between retries in milliseconds (1 second)
   */
  DEFAULT_RETRY_DELAY_MS: 1000,

  /**
   * Default log level
   */
  DEFAULT_LOG_LEVEL: 'warn' as const,

  /**
   * Default job request interval in seconds
   */
  DEFAULT_JOB_REQUEST_INTERVAL_SEC: 30,

  /**
   * Worker file server port (for LocalServer)
   */
  FILE_SERVER_PORT: 51115,

  /**
   * Delay before reconnecting after a clean long-poll timeout (ms).
   * Kept small so the worker re-registers quickly after the server signals
   * no job was available; 0 would be fine but a tiny buffer avoids tight
   * loops on edge-case server behaviour.
   */
  TIMEOUT_RECONNECT_DELAY_MS: 100,
} as const;

// ============================================================================
// Device Management Configuration
// ============================================================================

export const DEVICE_CONFIG = {
  /**
   * Default inactive threshold in minutes before a device is considered inactive
   */
  DEFAULT_INACTIVE_THRESHOLD_MINUTES: 30,

  /**
   * Minimum inactive threshold in minutes (1 minute)
   */
  MIN_INACTIVE_THRESHOLD_MINUTES: 1,

  /**
   * Maximum inactive threshold in minutes (24 hours)
   */
  MAX_INACTIVE_THRESHOLD_MINUTES: 1440,

  /**
   * Rating constraints
   */
  MIN_RATING: 0,
  MAX_RATING: 5,

  /**
   * Temperature constraints (in Celsius)
   */
  MIN_TEMPERATURE: -50,
  MAX_TEMPERATURE: 100,

  /**
   * Resource usage percentage constraints
   */
  MIN_USAGE_PERCENT: 0,
  MAX_USAGE_PERCENT: 100,
} as const;

// ============================================================================
// Job Configuration
// ============================================================================

export const JOB_CONFIG = {
  /**
   * Default job timeout in milliseconds (5 minutes)
   */
  DEFAULT_TIMEOUT_MS: 300000,

  /**
   * Maximum number of retry attempts for failed jobs
   */
  MAX_RETRY_ATTEMPTS: 3,

  /**
   * Default poll interval for job completion in milliseconds (5 seconds)
   */
  DEFAULT_POLL_INTERVAL_MS: 5000,

  /**
   * Script execution timeout multiplier (converts seconds to milliseconds)
   */
  SCRIPT_TIMEOUT_MULTIPLIER: 1000,
} as const;

// ============================================================================
// Time Constants
// ============================================================================

export const TIME_CONSTANTS = {
  /**
   * Milliseconds per second
   */
  MS_PER_SECOND: 1000,

  /**
   * Milliseconds per minute
   */
  MS_PER_MINUTE: 60000,

  /**
   * Milliseconds per hour
   */
  MS_PER_HOUR: 3600000,

  /**
   * Milliseconds per day
   */
  MS_PER_DAY: 86400000,

  /**
   * Seconds per minute
   */
  SECONDS_PER_MINUTE: 60,

  /**
   * Minutes per hour
   */
  MINUTES_PER_HOUR: 60,

  /**
   * Hours per day
   */
  HOURS_PER_DAY: 24,
} as const;

// ============================================================================
// Execution Engine Configuration
// ============================================================================

export const ENGINE_CONFIG = {
  /**
   * Default model for LLM execution
   */
  DEFAULT_MODEL: 'qwen3.5:2b',

  /**
   * Default temperature for LLM execution
   */
  DEFAULT_TEMPERATURE: 0.7,

  /**
   * Default temperature for review jobs
   */
  DEFAULT_TEMPERATURE_REVIEW: 0.3,

  /**
   * Minimum accepted score for job review (0-100)
   */
  MINIMUM_ACCEPTED_SCORE: 70,

  /**
   * Default context window size for LLM (Ollama num_ctx)
   */
  DEFAULT_NUM_CTX: 2048,

  /**
   * Maximum allowed context window size for validation
   */
  MAX_NUM_CTX: 1_000_000,

  /**
   * Default max tokens to generate (Ollama num_predict)
   */
  DEFAULT_NUM_PREDICT: 2048,
} as const;

// ============================================================================
// Resource Monitoring Configuration
// ============================================================================

export const RESOURCE_CONFIG = {
  /**
   * Interval for resource monitoring in milliseconds (30 seconds)
   */
  MONITORING_INTERVAL_MS: 30000,

  /**
   * CPU usage threshold for warnings (percentage)
   */
  CPU_WARNING_THRESHOLD: 80,

  /**
   * Memory usage threshold for warnings (percentage)
   */
  MEMORY_WARNING_THRESHOLD: 90,

  /**
   * Disk usage threshold for warnings (percentage)
   */
  DISK_WARNING_THRESHOLD: 95,
} as const;

// ============================================================================
// Model File Size Estimates (in bytes)
// ============================================================================

export const MODEL_SIZES = {
  /**
   * Base size for checkpoints in bytes (6 GB)
   */
  CHECKPOINT: 6000000000,

  /**
   * Base size for LoRA models in bytes (100 MB)
   */
  LORA: 100000000,

  /**
   * Base size for VAE models in bytes (300 MB)
   */
  VAE: 300000000,

  /**
   * Base size for ControlNet models in bytes (1 GB)
   */
  CONTROLNET: 1000000000,

  /**
   * Base size for embeddings in bytes (1 MB)
   */
  EMBEDDING: 1000000,

  /**
   * Default fallback size in bytes (100 MB)
   */
  DEFAULT: 100000000,
} as const;

// ============================================================================
// Frontend Configuration
// ============================================================================

export const FRONTEND_CONFIG = {
  /**
   * Development server port
   */
  DEV_SERVER_PORT: 3000,

  /**
   * Polling intervals
   */
  POLLING: {
    /**
     * Worker data refresh interval in milliseconds (5 seconds)
     */
    WORKERS_REFRESH_MS: 5000,

    /**
     * Health check interval in milliseconds (30 seconds)
     */
    HEALTH_CHECK_MS: 30000,

    /**
     * Dashboard data refresh interval in milliseconds (5 seconds)
     */
    DASHBOARD_REFRESH_MS: 5000,

    /**
     * Delay after operations before refreshing in milliseconds (2 seconds)
     */
    POST_OPERATION_DELAY_MS: 2000,
  },

  /**
   * UI Constants
   */
  UI: {
    /**
     * Maximum number of items to display per page
     */
    DEFAULT_PAGE_SIZE: 10,

    /**
     * Maximum length for truncated text
     */
    MAX_TEXT_LENGTH: 100,
  },
} as const;

// ============================================================================
// Database Configuration
// ============================================================================

export const DATABASE_CONFIG = {
  /**
   * Default database type
   */
  DEFAULT_TYPE: 'sqlite' as 'sqlite' | 'memory',

  /**
   * Default database file path
   */
  DEFAULT_PATH: './job-server.db',
} as const;

// ============================================================================
// HTTP Status Codes
// ============================================================================

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// ============================================================================
// Response Messages
// ============================================================================

export const RESPONSE_MESSAGES = {
  NO_JOBS_AVAILABLE: 'No available jobs',
  JOB_NOT_FOUND: 'Job not found',
  DEVICE_NOT_FOUND: 'Device not found',
  WORKER_NOT_FOUND: 'Worker not found',
  FAILED_TO_CREATE_JOB: 'Failed to create job',
  FAILED_TO_FETCH_JOBS: 'Failed to fetch jobs',
  FAILED_TO_REGISTER_DEVICE: 'Failed to register device',
  FAILED_TO_REFRESH_DEVICES: 'Failed to refresh devices',
  REFRESH_COMPLETED: 'Refresh completed successfully',
} as const;

// ============================================================================
// Worker Update Configuration
// ============================================================================

export const WORKER_UPDATE_CONFIG = {
  /**
   * Latest worker version that should be running
   * Can be overridden via environment variable WORKER_LATEST_VERSION
   */
  LATEST_VERSION:
    (typeof process !== 'undefined' && process.env?.WORKER_LATEST_VERSION) ||
    '0.1.0',

  /**
   * Whether to enable automatic update notifications
   */
  ENABLE_UPDATE_NOTIFICATIONS:
    typeof process !== 'undefined' &&
    process.env?.WORKER_UPDATE_ENABLED !== 'false',
} as const;

// ============================================================================
// Unified API Configuration
// ============================================================================

export const API_CONFIG = {
  /**
   * Server configuration
   */
  SERVER: SERVER_CONFIG,

  /**
   * Worker configuration
   */
  WORKER: WORKER_CONFIG,

  /**
   * Get full API URL
   */
  getApiUrl: (hostname: string = 'localhost') =>
    `http://${hostname}:${SERVER_CONFIG.DEFAULT_PORT}${SERVER_CONFIG.API_BASE_PATH}`,

  /**
   * Get worker file server URL
   */
  getWorkerFileServerUrl: (hostname: string = 'localhost') =>
    `http://${hostname}:${WORKER_CONFIG.FILE_SERVER_PORT}`,
} as const;
