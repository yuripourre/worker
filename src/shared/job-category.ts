/**
 * JobCategory – source of truth is packages/middleware/middleware.js.
 */
import { JOB_CATEGORIES } from '../../../middleware/middleware.js';

export const JobCategory = JOB_CATEGORIES;
export type JobCategoryType = (typeof JOB_CATEGORIES)[keyof typeof JOB_CATEGORIES];
