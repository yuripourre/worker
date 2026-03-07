/**
 * Execution types are defined in shared; re-export for worker use.
 * Worker's Executor implements IJobExecutor from shared.
 */
export { JobCategory } from '../shared';
export type {
  JobCategoryType,
  ExecutableJob,
  StatusOutput,
  ExecutableJobResult,
  IJobExecutor,
  ExecutorConfig,
} from '../shared';
