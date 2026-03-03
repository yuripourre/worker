/**
 * Worker Configuration Constants
 * Centralized location for all configuration values and magic numbers
 */

// ============================================================================
// Worker Client Configuration
// ============================================================================

export const WORKER_CONFIG = {
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
} as const;

// ============================================================================
// Job Execution Configuration
// ============================================================================

export const JOB_CONFIG = {
  /**
   * Default poll interval for job completion in milliseconds (5 seconds)
   */
  DEFAULT_POLL_INTERVAL_MS: 5000,

  /**
   * Default timeout for job execution in milliseconds (5 minutes)
   */
  DEFAULT_TIMEOUT_MS: 300000,

  /**
   * Script execution timeout multiplier (converts seconds to milliseconds)
   */
  SCRIPT_TIMEOUT_MULTIPLIER: 1000,
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
// Time Conversion Constants
// ============================================================================

export const TIME_CONVERSION = {
  /**
   * Milliseconds per second
   */
  MS_PER_SECOND: 1000,

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
  DEFAULT_MODEL: 'qwen3:1.7b',

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







