import { ExecutableJob, ExecutableJobResult } from '../../types';
import { LLMClient } from '../../llm-client';
import { CategoryExecutor } from './category-executor';
import { isLLMJobContext } from '../../../shared';
import { OutputArtifactHelper } from '../output-artifact-helper';

/**
 * LLM Category Executor
 * Handles LLM-based jobs by calling the LLM client directly.
 * When tools are present, worker executes them locally as subprocesses.
 */
export class LLMCategoryExecutor implements CategoryExecutor {
  constructor(private llmClient: LLMClient) {}

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isLLMJobContext(job.context)) {
      return { status: 'failed', answer: 'Invalid LLM job context' };
    }
    const ctx = job.context;
    if (ctx.tools && ctx.tools.length > 0) {
      console.log(`🔗 Tools (${ctx.tools.length}): ${ctx.tools.map(t => t.name).join(', ')}`);
    }
    const options = {
      model: ctx.model,
      temperature: ctx.temperature,
      prompt: ctx.userPrompt ?? '',
      systemPrompt: ctx.systemPrompt,
      tools: ctx.tools,
      image: ctx.image,
      numCtx: ctx.numCtx,
      numPredict: ctx.numPredict,
      think: ctx.think,
      topP: ctx.topP,
      topK: ctx.topK,
      repeatPenalty: ctx.repeatPenalty,
      seed: ctx.seed,
      format: ctx.format,
    };
    const response = await this.llmClient.chat(options);
    const result: ExecutableJobResult = {
      status: 'success',
      answer: response.content,
      executionDetails: response.debugInfo ? { debugInfo: response.debugInfo } : undefined,
    };

    // Check if outputType is 'text' or 'image' and create artifact
    if (isLLMJobContext(job.context) && job.context.outputType) {
      const outputType = job.context.outputType;

      if (outputType === 'text' || outputType === 'image') {
        try {
          if (outputType === 'text') {
            // Save output as text artifact
            const artifact = await OutputArtifactHelper.createTextArtifact(
              job.id,
              result.answer,
              'unknown'
            );
            result.artifacts = [artifact];
          } else if (outputType === 'image') {
            // Extract image data from the output if present
            const extracted = OutputArtifactHelper.extractImageFromText(result.answer);

            if (extracted.imageData) {
              const artifact = await OutputArtifactHelper.createImageArtifact(
                job.id,
                extracted.imageData,
                'unknown',
                extracted.mimeType
              );
              result.artifacts = [artifact];
              result.answer = extracted.cleanText;
            } else {
              // No image data found, save as text artifact
              const artifact = await OutputArtifactHelper.createTextArtifact(
                job.id,
                result.answer,
                'unknown'
              );
              result.artifacts = [artifact];
            }
          }
        } catch (error) {
          console.error(`Failed to create output artifact for job ${job.id}:`, error);
          // Don't fail the job, just log the error
        }
      }
    }

    return result;
  }
}
