/**
 * JobCategory and FILE_OPERATIONS – source of truth is packages/middleware/middleware.js.
 */
import {
  JOB_CATEGORIES,
  FILE_OPERATIONS as MW_FILE_OPERATIONS,
  FILE_OPERATION_LIST as MW_FILE_OPERATION_LIST,
} from '../../../middleware/middleware.js';

export const JobCategory = JOB_CATEGORIES;
export type JobCategoryType = (typeof JOB_CATEGORIES)[keyof typeof JOB_CATEGORIES];

export const FILE_OPERATIONS = MW_FILE_OPERATIONS;
export const FILE_OPERATION_LIST = MW_FILE_OPERATION_LIST;
export type FileOperationType = (typeof MW_FILE_OPERATIONS)[keyof typeof MW_FILE_OPERATIONS];
