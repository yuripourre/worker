import { ExecutableJob, ExecutableJobResult } from '../../types';

/**
 * Interface for category-specific executors
 * Each category (LLM, Script, FileRequest, ImageGeneration) implements this interface
 */
export interface CategoryExecutor {
  executeExecution(job: ExecutableJob): Promise<ExecutableJobResult>;
}
