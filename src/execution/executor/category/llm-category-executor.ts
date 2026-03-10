import { resolve } from 'path';
import { ExecutableJob, ExecutableJobResult } from '../../types';
import { LLMClient } from '../../llm-client';
import { CategoryExecutor } from './category-executor';
import { isLLMJobContext } from '../../../shared';
import type { LLMToolDefinition } from '../../../shared';
import { OutputArtifactHelper } from '../output-artifact-helper';

const TOOLS_BASE = resolve(import.meta.dir, '../../../tools');

function getWorkspaceTools(): LLMToolDefinition[] {
  return [
    {
      name: 'workspace_list_files',
      description: 'List files in the shared workspace. Use workspaceId to identify the workspace.',
      type: 'typescript',
      parameters: [
        { name: 'workspaceId', type: 'string', description: 'Workspace ID', required: true },
        { name: 'path', type: 'string', description: 'Optional subpath to list', required: false },
      ],
      _absolutePath: resolve(TOOLS_BASE, 'workspace-list-files/index.ts'),
    },
    {
      name: 'workspace_read_file',
      description: 'Read a file from the shared workspace.',
      type: 'typescript',
      parameters: [
        { name: 'workspaceId', type: 'string', description: 'Workspace ID', required: true },
        { name: 'path', type: 'string', description: 'File path in the workspace', required: true },
      ],
      _absolutePath: resolve(TOOLS_BASE, 'workspace-read-file/index.ts'),
    },
    {
      name: 'workspace_write_file',
      description: 'Create or overwrite a file in the shared workspace.',
      type: 'typescript',
      parameters: [
        { name: 'workspaceId', type: 'string', description: 'Workspace ID', required: true },
        { name: 'path', type: 'string', description: 'File path in the workspace', required: true },
        { name: 'content', type: 'string', description: 'File content', required: true },
      ],
      _absolutePath: resolve(TOOLS_BASE, 'workspace-write-file/index.ts'),
    },
    {
      name: 'workspace_edit_file',
      description: 'Edit a file in the shared workspace by replacing oldContent with newContent.',
      type: 'typescript',
      parameters: [
        { name: 'workspaceId', type: 'string', description: 'Workspace ID', required: true },
        { name: 'path', type: 'string', description: 'File path in the workspace', required: true },
        { name: 'oldContent', type: 'string', description: 'Exact string to replace', required: true },
        { name: 'newContent', type: 'string', description: 'Replacement string', required: true },
      ],
      _absolutePath: resolve(TOOLS_BASE, 'workspace-edit-file/index.ts'),
    },
    {
      name: 'workspace_delete_file',
      description: 'Delete a file from the shared workspace.',
      type: 'typescript',
      parameters: [
        { name: 'workspaceId', type: 'string', description: 'Workspace ID', required: true },
        { name: 'path', type: 'string', description: 'File path in the workspace', required: true },
      ],
      _absolutePath: resolve(TOOLS_BASE, 'workspace-delete-file/index.ts'),
    },
  ];
}

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
    let tools = ctx.tools ?? [];
    if (ctx.workspaceId) {
      const workspacePrompt = `You have access to a shared workspace (ID: ${ctx.workspaceId}). Always pass this ID as the workspaceId parameter when using workspace_* tools.`;
      tools = [...tools, ...getWorkspaceTools()];
      if (ctx.tools && ctx.tools.length > 0) {
        console.log(`🔗 Tools (${tools.length}): ${tools.map(t => t.name).join(', ')}`);
      }
      const options = {
        model: ctx.model,
        temperature: ctx.temperature,
        prompt: ctx.userPrompt ?? '',
        systemPrompt: [workspacePrompt, ctx.systemPrompt].filter(Boolean).join('\n\n'),
        tools,
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
      if (isLLMJobContext(job.context) && job.context.outputType) {
        const outputType = job.context.outputType;
        if (outputType === 'text' || outputType === 'image') {
          try {
            if (outputType === 'text') {
              const artifact = await OutputArtifactHelper.createTextArtifact(job.id, result.answer, 'unknown');
              result.artifacts = [artifact];
            } else if (outputType === 'image') {
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
                const artifact = await OutputArtifactHelper.createTextArtifact(job.id, result.answer, 'unknown');
                result.artifacts = [artifact];
              }
            }
          } catch (error) {
            console.error(`Failed to create output artifact for job ${job.id}:`, error);
          }
        }
      }
      return result;
    }
    if (ctx.tools && ctx.tools.length > 0) {
      console.log(`🔗 Tools (${tools.length}): ${ctx.tools.map(t => t.name).join(', ')}`);
    }
    const options = {
      model: ctx.model,
      temperature: ctx.temperature,
      prompt: ctx.userPrompt ?? '',
      systemPrompt: ctx.systemPrompt,
      tools,
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
