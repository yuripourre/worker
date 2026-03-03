/**
 * Worker-specific types
 */

import type { Capability, ResourceUsage } from './types';

/**
 * Canonical worker status values (storage and API).
 */
export type WorkerStatus =
  | 'running'
  | 'idle'
  | 'stopped'
  | 'error'
  | 'maintenance'
  | 'paused'
  | 'offline'
  | 'terminated';

export const WORKER_STATUSES: readonly WorkerStatus[] = [
  'running',
  'idle',
  'stopped',
  'error',
  'maintenance',
  'paused',
  'offline',
  'terminated',
] as const;

export function isWorkerStatus(s: string): s is WorkerStatus {
  return (WORKER_STATUSES as readonly string[]).includes(s);
}

/**
 * Worker registration data
 */
export interface WorkerRegistration {
  deviceId: string;
  deviceName: string;
  ipAddress?: string;
}

/**
 * Worker information
 */
export interface WorkerInfo {
  id: string;
  deviceId: string;
  deviceName: string;
  status: WorkerStatus;
  startTime: string;
  lastHeartbeat: string;
  ipAddress?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
  temperature?: number;
  powerConsumption?: string;
  capabilities?: Capability[];
  lastUpdateDate?: string;
}

/**
 * Worker heartbeat update data
 */
export interface WorkerHeartbeat extends Partial<ResourceUsage> {
  temperature?: number;
  powerConsumption?: string;
  ipAddress?: string;
  lastUpdateDate?: string;
}

/**
 * Worker configuration stored on the worker
 */
export interface WorkerConfiguration {
  deviceName?: string;
  comfyuiPath?: string;
  comfyuiBaseUrl?: string;
  ollamaBaseUrl?: string;
}
