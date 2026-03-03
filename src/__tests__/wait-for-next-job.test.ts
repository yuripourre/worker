/**
 * Tests for Worker.registerForJob() — the long-poll fetch method.
 * Under Bun: skipped (Worker is mocked by job-reservation.test.ts; jest-fetch-mock is Jest-specific).
 * Under Jest: skipped (global fetch is not reliably mocked with node-fetch/cross-fetch in the stack).
 * Run with: bun test src/__tests__/wait-for-next-job.test.ts for full coverage (Bun test runner + fetch mock).
 */

// ── Module mocks (Jest) ───────────────────────────────────────────────────────

jest.mock('../utils/version-utils', () => ({
  getWorkerVersion: () => '1.0.0-test',
}));

jest.mock('../utils/specs-analyzer', () => ({
  SpecsAnalyzer: jest.fn().mockImplementation(() => ({
    getSystemSpecs: jest.fn().mockReturnValue({}),
    getCurrentResourceUsage: jest.fn().mockReturnValue({ temperature: 0 }),
    getPowerConsumption: jest.fn().mockReturnValue(0),
  })),
}));

jest.mock('../services/resource-service', () => ({
  ResourceService: jest.fn().mockImplementation(() => ({
    getCurrentResources: jest.fn().mockResolvedValue({ cpuUsage: 0, memoryUsage: 0, diskUsage: 0 }),
  })),
}));

jest.mock('../local-server', () => ({
  LocalServer: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    isServerRunning: jest.fn().mockReturnValue(false),
    setConfigUpdateCallback: jest.fn(),
  })),
}));

jest.mock('../execution/executor/executor', () => ({ Executor: jest.fn() }));
jest.mock('../execution/llm-client', () => ({ LLMClient: jest.fn() }));

// ── Imports ───────────────────────────────────────────────────────────────────

import fetchMock from 'jest-fetch-mock';
import { Worker } from '../worker';

// Run only under Bun test runner where fetch mock works; skip under Jest (fetch mock not applied)
const describeWaitForNextJob = typeof (globalThis as unknown as { Bun?: unknown }).Bun !== 'undefined' ? describe : describe.skip;

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:51111';
const DEVICE_ID = 'device-test-123';
const WORKER_ID = 'worker-test-456';

import { JobCategory } from '../shared';
import type { Job } from '../shared';

const mockJob: Job = {
  id: 'job-xyz',
  status: 'running',
  context: {
    category: JobCategory.LLM,
    model: 'test-model',
    userPrompt: 'hi',
    temperature: 0.7,
  },
  createdAt: new Date().toISOString(),
};

function makeWorker(): Worker {
  const w = new Worker({ baseUrl: BASE_URL }, { logLevel: 'none' });
  // Inject private fields so registerForJob() doesn't throw for missing IDs
  (w as any).config.deviceId = DEVICE_ID;
  (w as any).workerId = WORKER_ID;
  return w;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  fetchMock.resetMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describeWaitForNextJob('Worker.registerForJob()', () => {
  describe('request construction', () => {
    test('calls POST /api/jobs/register with deviceId and workerId in body', async () => {
      fetchMock.mockResponseOnce('', { status: 204 });

      await makeWorker().registerForJob();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('/api/jobs/register');
      expect((options as RequestInit).method).toBe('POST');
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.deviceId).toBe(DEVICE_ID);
      expect(body.workerId).toBe(WORKER_ID);
    });

    test('uses POST method', async () => {
      fetchMock.mockResponseOnce('', { status: 204 });

      await makeWorker().registerForJob();

      const [, options] = fetchMock.mock.calls[0];
      expect((options as RequestInit).method).toBe('POST');
    });

    test('sets Content-Type header', async () => {
      fetchMock.mockResponseOnce('', { status: 204 });

      await makeWorker().registerForJob();

      const [, options] = fetchMock.mock.calls[0];
      const headers = (options as RequestInit).headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    test('includes X-Device-ID header', async () => {
      fetchMock.mockResponseOnce('', { status: 204 });

      await makeWorker().registerForJob();

      const [, options] = fetchMock.mock.calls[0];
      const headers = (options as RequestInit).headers as Record<string, string>;
      expect(headers['X-Device-ID']).toBe(DEVICE_ID);
    });
  });

  describe('response handling', () => {
    test('returns null when the server responds with 204 (timeout, no job)', async () => {
      fetchMock.mockResponseOnce('', { status: 204 });

      const result = await makeWorker().registerForJob();

      expect(result).toBeNull();
    });

    test('returns the parsed job when the server responds with 200', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockJob), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

      const result = await makeWorker().registerForJob();

      expect(result).toEqual(mockJob);
    });

    test('throws an Error on unexpected status codes', async () => {
      fetchMock.mockResponseOnce('Internal Server Error', { status: 500 });

      await expect(makeWorker().registerForJob()).rejects.toThrow(
        'Unexpected status 500'
      );
    });

    test('throws an Error on 400 responses', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'bad request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });

      await expect(makeWorker().registerForJob()).rejects.toThrow('Unexpected status 400');
    });
  });

  describe('pre-flight guard checks', () => {
    test('throws when deviceId is not set', async () => {
      const w = new Worker({ baseUrl: BASE_URL }, { logLevel: 'none' });
      (w as any).workerId = WORKER_ID;
      // config.deviceId is undefined

      await expect(w.registerForJob()).rejects.toThrow('Device not registered');
    });

    test('throws when workerId is not set', async () => {
      const w = new Worker({ baseUrl: BASE_URL }, { logLevel: 'none' });
      (w as any).config.deviceId = DEVICE_ID;
      // workerId is undefined

      await expect(w.registerForJob()).rejects.toThrow('Worker not registered');
    });
  });

  describe('URL construction', () => {
    test('uses baseUrl from config', async () => {
      fetchMock.mockResponseOnce('', { status: 204 });

      const w = new Worker({ baseUrl: 'http://my-server:9999' }, { logLevel: 'none' });
      (w as any).config.deviceId = DEVICE_ID;
      (w as any).workerId = WORKER_ID;

      await w.registerForJob();

      const [url] = fetchMock.mock.calls[0];
      expect(url).toMatch(/^http:\/\/my-server:9999/);
    });
  });
});
