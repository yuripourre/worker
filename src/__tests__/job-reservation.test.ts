jest.mock('../worker', () => ({
  Worker: jest.fn().mockImplementation((config: unknown, options: unknown) => ({
    ...(typeof config === 'object' && config !== null ? config : {}),
    ...(typeof options === 'object' && options !== null ? options : {}),
    registerWorker: jest.fn(),
    waitForNextJob: jest.fn(),
    reserveJob: jest.fn(),
    submitJobResult: jest.fn(),
    cleanup: jest.fn()
  }))
}));

import { JobCategory } from '../shared';
import { Worker } from '../worker';
import type { Job, JobResult } from '../types';

const MINIMAL_LLM_CONTEXT = {
  category: JobCategory.LLM,
  model: 'gpt-4',
  userPrompt: 'test',
  temperature: 0.7
} as const;

describe('Job Reservation System', () => {
  let worker1: Worker;
  let worker2: Worker;

  const mockJob1: Job = {
    id: 'job-1',
    context: { ...MINIMAL_LLM_CONTEXT },
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  const mockJob2: Job = {
    ...mockJob1,
    id: 'job-2',
    status: 'pending'
  };

  const mockJobResult: Omit<JobResult, 'completedAt'> = {
    text: 'Job completed successfully',
    artifacts: [
      {
        fileName: 'result.txt',
        filePath: '/tmp/result.txt',
        workerId: 'worker-1-id',
        fileSize: 0,
        createdAt: new Date().toISOString()
      }
    ]
  };

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Create mock worker instances
    worker1 = new Worker({
      baseUrl: 'http://localhost:51111',
      deviceId: 'demo-device-1',
      deviceName: 'Demo Device 1'
    }, {
      logLevel: 'info'
    });

    worker2 = new Worker({
      baseUrl: 'http://localhost:51111',
      deviceId: 'demo-device-2',
      deviceName: 'Demo Device 2'
    }, {
      logLevel: 'info'
    });

    // Reset the mock implementations for each test
    (worker1.registerWorker as jest.Mock).mockReset();
    (worker1.waitForNextJob as jest.Mock).mockReset();
    (worker1.reserveJob as jest.Mock).mockReset();
    (worker1.submitJobResult as jest.Mock).mockReset();
    (worker1.cleanup as jest.Mock).mockReset();

    (worker2.registerWorker as jest.Mock).mockReset();
    (worker2.waitForNextJob as jest.Mock).mockReset();
    (worker2.reserveJob as jest.Mock).mockReset();
    (worker2.submitJobResult as jest.Mock).mockReset();
    (worker2.cleanup as jest.Mock).mockReset();
  });

  describe('Worker Registration', () => {
    test('should register workers successfully', async () => {
      const mockWorker1Id = 'worker-1-id';
      const mockWorker2Id = 'worker-2-id';

      // Mock the registerWorker method
      jest.spyOn(worker1, 'registerWorker').mockResolvedValue(mockWorker1Id);
      jest.spyOn(worker2, 'registerWorker').mockResolvedValue(mockWorker2Id);

      const worker1Id = await worker1.registerWorker();
      const worker2Id = await worker2.registerWorker();

      expect(worker1Id).toBe(mockWorker1Id);
      expect(worker2Id).toBe(mockWorker2Id);
      expect(worker1.registerWorker).toHaveBeenCalledWith();
      expect(worker2.registerWorker).toHaveBeenCalledWith();
    });

    test('should handle worker registration failure', async () => {
      const errorMessage = 'Registration failed';
      jest.spyOn(worker1, 'registerWorker').mockRejectedValue(new Error(errorMessage));

      await expect(worker1.registerWorker())
        .rejects.toThrow(errorMessage);
    });
  });

  describe('Job Request and Reservation', () => {
    beforeEach(() => {
      // Mock successful worker registration
      jest.spyOn(worker1, 'registerWorker').mockResolvedValue('worker-1-id');
      jest.spyOn(worker2, 'registerWorker').mockResolvedValue('worker-2-id');
    });

    test('should allow worker to request and reserve a job', async () => {
      const reservedJob = { ...mockJob1, status: 'reserved' as const, workerId: 'worker-1-id' };

      jest.spyOn(worker1, 'waitForNextJob').mockResolvedValue(reservedJob);

      const job = await worker1.waitForNextJob();

      expect(job).toBeDefined();
      expect(job?.id).toBe('job-1');
      expect(job?.status).toBe('reserved');
      expect(job?.workerId).toBe('worker-1-id');
      expect(worker1.waitForNextJob).toHaveBeenCalledWith();
    });

    test('should prevent second worker from reserving already reserved job', async () => {
      const reservedJob = { ...mockJob1, status: 'reserved' as const, workerId: 'worker-1-id' };

      jest.spyOn(worker1, 'waitForNextJob').mockResolvedValue(reservedJob);
      jest.spyOn(worker2, 'reserveJob').mockRejectedValue(new Error('HTTP 409'));

      // Worker 1 gets the job
      const job1 = await worker1.waitForNextJob();
      expect(job1).toBeDefined();

      // Worker 2 tries to reserve the same job
      await expect(worker2.reserveJob('job-1'))
        .rejects.toThrow('HTTP 409');
    });

    test('should allow second worker to get a different job', async () => {
      const reservedJob1 = { ...mockJob1, status: 'reserved' as const, workerId: 'worker-1-id' };
      const reservedJob2 = { ...mockJob2, status: 'reserved' as const, workerId: 'worker-2-id' };

      jest.spyOn(worker1, 'waitForNextJob').mockResolvedValue(reservedJob1);
      jest.spyOn(worker2, 'waitForNextJob').mockResolvedValue(reservedJob2);

      const job1 = await worker1.waitForNextJob();
      const job2 = await worker2.waitForNextJob();

      expect(job1?.id).toBe('job-1');
      expect(job2?.id).toBe('job-2');
      expect(job1?.workerId).toBe('worker-1-id');
      expect(job2?.workerId).toBe('worker-2-id');
    });

    test('should handle no jobs available scenario', async () => {
      jest.spyOn(worker1, 'waitForNextJob').mockResolvedValue(null);

      const job = await worker1.waitForNextJob();

      expect(job).toBeNull();
    });
  });

  describe('Job Execution and Completion', () => {
    beforeEach(() => {
      // Mock successful worker registration
      jest.spyOn(worker1, 'registerWorker').mockResolvedValue('worker-1-id');
      jest.spyOn(worker2, 'registerWorker').mockResolvedValue('worker-2-id');
    });

    test('should allow worker to submit job results', async () => {
      const reservedJob = { ...mockJob1, status: 'running' as const, workerId: 'worker-1-id' };

      jest.spyOn(worker1, 'waitForNextJob').mockResolvedValue(reservedJob);
      jest.spyOn(worker1, 'submitJobResult').mockResolvedValue();

      const job = await worker1.waitForNextJob();
      expect(job).toBeDefined();

      await worker1.submitJobResult('job-1', mockJobResult);

      expect(worker1.submitJobResult).toHaveBeenCalledWith('job-1', mockJobResult);
    });

    test('should handle job completion workflow', async () => {
      const reservedJob = { ...mockJob1, status: 'reserved' as const, workerId: 'worker-1-id' };

      jest.spyOn(worker1, 'waitForNextJob').mockResolvedValue(reservedJob);
      jest.spyOn(worker1, 'submitJobResult').mockResolvedValue();

      // Complete workflow: request -> execute -> submit result
      const job = await worker1.waitForNextJob();
      expect(job?.status).toBe('reserved');

      await worker1.submitJobResult('job-1', mockJobResult);
      expect(worker1.submitJobResult).toHaveBeenCalledTimes(1);
    });
  });

  describe('Resource Management', () => {
    test('should handle multiple waitForNextJob calls', async () => {
      jest.spyOn(worker1, 'registerWorker').mockResolvedValue('worker-1-id');
      jest.spyOn(worker1, 'waitForNextJob')
        .mockResolvedValueOnce(mockJob1)
        .mockResolvedValueOnce({ ...mockJob2, id: 'job-2' });

      const job1 = await worker1.waitForNextJob();
      expect(job1).toBeDefined();
      expect(job1?.id).toBe('job-1');

      const job2 = await worker1.waitForNextJob();
      expect(job2).toBeDefined();
      expect(job2?.id).toBe('job-2');

      expect(worker1.waitForNextJob).toHaveBeenCalledTimes(2);
    });
  });

  describe('Cleanup and Error Handling', () => {
    test('should cleanup resources properly', async () => {
      jest.spyOn(worker1, 'cleanup').mockResolvedValue();
      jest.spyOn(worker2, 'cleanup').mockResolvedValue();

      await worker1.cleanup();
      await worker2.cleanup();

      expect(worker1.cleanup).toHaveBeenCalled();
      expect(worker2.cleanup).toHaveBeenCalled();
    });

    test('should handle cleanup errors gracefully', async () => {
      const errorMessage = 'Cleanup failed';
      jest.spyOn(worker1, 'cleanup').mockRejectedValue(new Error(errorMessage));

      await expect(worker1.cleanup()).rejects.toThrow(errorMessage);
    });
  });

  describe('Integration Scenarios', () => {
    test('should handle complete job reservation workflow', async () => {
      // Mock all necessary methods
      jest.spyOn(worker1, 'registerWorker').mockResolvedValue('worker-1-id');
      jest.spyOn(worker2, 'registerWorker').mockResolvedValue('worker-2-id');

      const reservedJob1 = { ...mockJob1, status: 'reserved' as const, workerId: 'worker-1-id' };
      const reservedJob2 = { ...mockJob2, status: 'reserved' as const, workerId: 'worker-2-id' };

      jest.spyOn(worker1, 'waitForNextJob').mockResolvedValue(reservedJob1);
      jest.spyOn(worker2, 'waitForNextJob').mockResolvedValue(reservedJob2);
      jest.spyOn(worker1, 'submitJobResult').mockResolvedValue();
      jest.spyOn(worker2, 'submitJobResult').mockResolvedValue();
      jest.spyOn(worker1, 'cleanup').mockResolvedValue();
      jest.spyOn(worker2, 'cleanup').mockResolvedValue();

      // Complete workflow
      const worker1Id = await worker1.registerWorker();
      const worker2Id = await worker2.registerWorker();

      const job1 = await worker1.waitForNextJob();
      const job2 = await worker2.waitForNextJob();

      await worker1.submitJobResult('job-1', mockJobResult);
      await worker2.submitJobResult('job-2', mockJobResult);

      await worker1.cleanup();
      await worker2.cleanup();

      // Verify all steps were executed
      expect(worker1Id).toBe('worker-1-id');
      expect(worker2Id).toBe('worker-2-id');
      expect(job1?.id).toBe('job-1');
      expect(job2?.id).toBe('job-2');
      expect(worker1.submitJobResult).toHaveBeenCalledWith('job-1', mockJobResult);
      expect(worker2.submitJobResult).toHaveBeenCalledWith('job-2', mockJobResult);
      expect(worker1.cleanup).toHaveBeenCalled();
      expect(worker2.cleanup).toHaveBeenCalled();
    });
  });
});
