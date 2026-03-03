import { ComfyUIClient } from '../lib/comfyui/comfyui-client';
import { ImageGenerationCategoryExecutor } from '../execution/executor/category/image-generation-category-executor';
import { ExecutableJob, JobCategory } from '../execution/types';
import { ImageGenerationJobContext } from '../shared';
import fetchMock from 'jest-fetch-mock';

const isBun = typeof (globalThis as unknown as { Bun?: unknown }).Bun !== 'undefined';
const describeComfyUI = isBun ? describe.skip : describe;

// Mock LLM Client
class MockLLMClient {
  async chat(params: any): Promise<{ content: string; debugInfo?: any }> {
    return { content: 'Mock LLM response' };
  }
}

describeComfyUI('ComfyUI Queue Mode', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  describe('ComfyUIClient Queue Methods', () => {
    let client: ComfyUIClient;

    beforeEach(() => {
      client = new ComfyUIClient({ baseUrl: 'http://localhost:8188' });
    });

    describe('queuePrompt', () => {
      it('should submit a prompt and return prompt_id', async () => {
        const mockResponse = {
          prompt_id: 'abc123',
          number: 1
        };

        fetchMock.mockResponseOnce(JSON.stringify(mockResponse));

        const result = await client.queuePrompt({
          prompt: {
            seed: 98765,
            positive: 'a futuristic city skyline',
            negative: 'blurry, dark'
          },
          extra_data: {
            inputs: {
              seed: 98765,
              positive: 'a futuristic city skyline',
              negative: 'blurry, dark'
            }
          }
        });

        expect(result.prompt_id).toBe('abc123');
        expect(result.number).toBe(1);
        expect(fetchMock).toHaveBeenCalledWith(
          'http://localhost:8188/prompt',
          expect.objectContaining({
            method: 'POST'
          })
        );

        // Verify the request body contains the correct data
        const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
        expect(requestBody.extra_data).toBeDefined();
        expect(requestBody.prompt.seed).toBe(98765);
      });

      it('should handle queue errors', async () => {
        fetchMock.mockResponseOnce('Internal Server Error', { status: 500 });

        await expect(
          client.queuePrompt({
            prompt: { '1': { inputs: {} } }
          })
        ).rejects.toThrow('Failed to queue prompt');
      });

      it('should include extra_data in the request', async () => {
        const mockResponse = { prompt_id: 'test123', number: 1 };
        fetchMock.mockResponseOnce(JSON.stringify(mockResponse));

        const promptData = {
          seed: 12345,
          positive: 'test prompt',
          negative: 'bad quality'
        };

        await client.queuePrompt({
          prompt: promptData,
          extra_data: { inputs: promptData }
        });

        const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
        expect(requestBody.extra_data).toBeDefined();
        expect(requestBody.prompt.seed).toBe(12345);
      });
    });

    describe('getPromptStatus', () => {
      it('should return pending status when prompt not found', async () => {
        fetchMock.mockResponseOnce(JSON.stringify({}));

        const status = await client.getPromptStatus('not-found');

        expect(status.status).toBe('pending');
        expect(status.progress).toBe(0);
      });

      it('should return completed status with output', async () => {
        const mockHistoryResponse = {
          'test-prompt-id': {
            outputs: {
              '9': {
                images: [
                  { filename: 'output_123.png', subfolder: '', type: 'output' }
                ]
              }
            }
          }
        };

        fetchMock.mockResponseOnce(JSON.stringify(mockHistoryResponse));

        const status = await client.getPromptStatus('test-prompt-id');

        expect(status.status).toBe('completed');
        expect(status.output?.images).toHaveLength(1);
        expect(status.output.images[0].filename).toBe('output_123.png');
      });

      it('should return failed status on error', async () => {
        const mockHistoryResponse = {
          'test-prompt-id': {
            status: { status_str: 'error' },
            error: 'Test error message'
          }
        };

        fetchMock.mockResponseOnce(JSON.stringify(mockHistoryResponse));

        const status = await client.getPromptStatus('test-prompt-id');

        expect(status.status).toBe('failed');
        expect(status.error).toBe('Test error message');
      });
    });

    describe('waitForPromptCompletion', () => {
      it('should poll until completion', async () => {
        // First call: executing
        fetchMock.mockResponseOnce(JSON.stringify({
          'test-id': {
            prompt: []
          }
        }));

        // Second call: completed
        fetchMock.mockResponseOnce(JSON.stringify({
          'test-id': {
            outputs: {
              '9': {
                images: [{ filename: 'result.png', subfolder: '', type: 'output' }]
              }
            }
          }
        }));

        const result = await client.waitForPromptCompletion('test-id', 5000);

        expect(result.status).toBe('completed');
        expect(result.images).toHaveLength(1);
        expect(result.images?.[0].filename).toBe('result.png');
      });

      it('should handle failure during polling', async () => {
        fetchMock.mockResponseOnce(JSON.stringify({
          'test-id': {
            status: { status_str: 'error' },
            error: 'Generation failed'
          }
        }));

        const result = await client.waitForPromptCompletion('test-id', 5000);

        expect(result.status).toBe('failed');
        expect(result.error).toBe('Generation failed');
      });
    });
  });

  describe('ImageGenerationCategoryExecutor Queue Mode', () => {
    let executor: ImageGenerationCategoryExecutor;
    let mockLLMClient: MockLLMClient;

    beforeEach(() => {
      mockLLMClient = new MockLLMClient();
      executor = new ImageGenerationCategoryExecutor(
        mockLLMClient as any,
        'http://localhost:3000',
        'test-device',
        'test-worker'
      );
    });

    describe('executeExecution with queue mode', () => {
      it('should submit to ComfyUI and wait for completion', async () => {
        // Mock ComfyUI health check
        fetchMock.mockResponseOnce(JSON.stringify({ status: 'ok' }));

        // Mock queue prompt response
        fetchMock.mockResponseOnce(JSON.stringify({
          prompt_id: 'generated-prompt-id',
          number: 5
        }));

        // Mock history check (completed)
        fetchMock.mockResponseOnce(JSON.stringify({
          'generated-prompt-id': {
            outputs: {
              '9': {
                images: [{ filename: 'output.png', subfolder: '', type: 'output' }]
              }
            }
          }
        }));

        // Mock image download
        const mockImageBuffer = Buffer.from('fake-image-data');
        fetchMock.mockResponseOnce(mockImageBuffer.toString('binary'), {
          headers: { 'content-type': 'image/png' }
        });

        const job: ExecutableJob = {
          id: 'test-job-3',
          context: {
            category: JobCategory.IMAGE_GENERATION,
            prompt: 'a futuristic city skyline',
            negativePrompt: 'blurry, dark',
            seed: 98765,
            queueMode: true
          } as ImageGenerationJobContext,
          status: 'in_progress',
          category: JobCategory.IMAGE_GENERATION
        };

        const result = await executor.executeExecution(job);

        expect(result.status).toBe('success');
        expect(result.answer).toContain('generated-prompt-id');
        expect(result.answer).toContain('Queue Number: 5');
        expect(result.artifacts).toBeDefined();
        expect(result.artifacts?.length).toBeGreaterThan(0);
      });

      it('should fail gracefully when ComfyUI is not available', async () => {
        // Mock ComfyUI health check failure
        fetchMock.mockRejectOnce(new Error('Connection refused'));

        const job: ExecutableJob = {
          id: 'test-job-4',
          context: {
            category: JobCategory.IMAGE_GENERATION,
            prompt: 'test prompt',
            queueMode: true
          } as ImageGenerationJobContext,
          status: 'in_progress',
          category: JobCategory.IMAGE_GENERATION
        };

        const result = await executor.executeExecution(job);

        expect(result.status).toBe('failed');
        expect(result.answer).toContain('not available');
      });

      it('should handle ComfyUI execution errors', async () => {
        // Mock ComfyUI health check
        fetchMock.mockResponseOnce(JSON.stringify({ status: 'ok' }));

        // Mock queue prompt response
        fetchMock.mockResponseOnce(JSON.stringify({
          prompt_id: 'error-prompt-id',
          number: 1
        }));

        // Mock history check (failed)
        fetchMock.mockResponseOnce(JSON.stringify({
          'error-prompt-id': {
            status: { status_str: 'error' },
            error: 'Model not found'
          }
        }));

        const job: ExecutableJob = {
          id: 'test-job-5',
          context: {
            category: JobCategory.IMAGE_GENERATION,
            prompt: 'test prompt',
            negativePrompt: 'bad quality',
            queueMode: true
          } as ImageGenerationJobContext,
          status: 'in_progress',
          category: JobCategory.IMAGE_GENERATION
        };

        const result = await executor.executeExecution(job);

        expect(result.status).toBe('failed');
        expect(result.answer).toContain('failed');
      });

      it('should persist prompt_id in job context', async () => {
        const GENERATED_PROMPT_ID = 'persisted-prompt-id';

        // Mock ComfyUI health check
        fetchMock.mockResponseOnce(JSON.stringify({ status: 'ok' }));

        // Mock queue prompt response
        fetchMock.mockResponseOnce(JSON.stringify({
          prompt_id: GENERATED_PROMPT_ID,
          number: 1
        }));

        // Mock history check (completed)
        fetchMock.mockResponseOnce(JSON.stringify({
          [GENERATED_PROMPT_ID]: {
            outputs: {
              '9': {
                images: [{ filename: 'output.png', subfolder: '', type: 'output' }]
              }
            }
          }
        }));

        // Mock image download
        const mockImageBuffer = Buffer.from('fake-image-data');
        fetchMock.mockResponseOnce(mockImageBuffer.toString('binary'), {
          headers: { 'content-type': 'image/png' }
        });

        const context: ImageGenerationJobContext = {
          category: JobCategory.IMAGE_GENERATION,
          prompt: 'test prompt',
          negativePrompt: 'low quality',
          seed: 54321,
          queueMode: true
        };

        const job: ExecutableJob = {
          id: 'test-job-6',
          context,
          status: 'in_progress',
          category: JobCategory.IMAGE_GENERATION
        };

        await executor.executeExecution(job);

        // Check that promptId was set in the context
        expect(context.promptId).toBe(GENERATED_PROMPT_ID);
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle full queue mode workflow from creation to completion', async () => {
      const executor = new ImageGenerationCategoryExecutor(
        new MockLLMClient() as any,
        'http://localhost:3000',
        'test-device',
        'test-worker'
      );

      const context: ImageGenerationJobContext = {
        category: JobCategory.IMAGE_GENERATION,
        prompt: 'a beautiful sunset over mountains',
        negativePrompt: 'people, buildings',
        seed: 12345,
        queueMode: true
      };

      const job: ExecutableJob = {
        id: 'integration-test-1',
        context,
        status: 'in_progress',
        category: JobCategory.IMAGE_GENERATION
      };

      fetchMock.mockResponseOnce(JSON.stringify({ status: 'ok' }));
      fetchMock.mockResponseOnce(JSON.stringify({ prompt_id: 'int-test-id', number: 1 }));
      fetchMock.mockResponseOnce(JSON.stringify({
        'int-test-id': {
          outputs: { '9': { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] } }
        }
      }));
      fetchMock.mockResponseOnce(Buffer.from('image-data').toString('binary'), {
        headers: { 'content-type': 'image/png' }
      });

      const execResult = await executor.executeExecution(job);

      expect(execResult.status).toBe('success');
      expect(context.promptId).toBe('int-test-id');
      expect(execResult.artifacts).toBeDefined();
    });

    it('should support queue mode execution', async () => {
      const executor = new ImageGenerationCategoryExecutor(
        new MockLLMClient() as any,
        'http://localhost:3000',
        'test-device',
        'test-worker'
      );

      const queueModeJob: ExecutableJob = {
        id: 'mixed-1',
        context: {
          category: JobCategory.IMAGE_GENERATION,
          prompt: 'queue mode test',
          negativePrompt: 'bad',
          seed: 999,
          queueMode: true
        } as ImageGenerationJobContext,
        status: 'in_progress',
        category: JobCategory.IMAGE_GENERATION
      };

      fetchMock.mockResponseOnce(JSON.stringify({ status: 'ok' }));
      fetchMock.mockResponseOnce(JSON.stringify({ prompt_id: 'queue-id', number: 1 }));
      fetchMock.mockResponseOnce(JSON.stringify({
        'queue-id': {
          outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } }
        }
      }));
      fetchMock.mockResponseOnce(Buffer.from('img').toString('binary'), { headers: { 'content-type': 'image/png' } });

      const queueResult = await executor.executeExecution(queueModeJob);
      expect(queueResult.status).toBe('success');
      expect(queueResult.answer).toContain('queue mode');
    });
  });
});

