/**
 * JobStatus – source of truth is packages/middleware/middleware.js.
 */
import { JOB_STATUS } from '../../../middleware/middleware.js';

export const JobStatus = JOB_STATUS;
export type JobStatusType = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];
