import type { JobContext, BaseJobContext, LLMThinkLevel } from './types';
import { JobCategory } from './types';
import {
  isLLMJobContext,
  isScriptJobContext,
  isImageGenerationJobContext,
  isHttpRequestJobContext,
  isImageJobContext,
} from './types';

export const MODEL_TAG_PREFIX = 'model:';
export const CHECKPOINT_TAG_PREFIX = 'checkpoint:';
export const LORA_TAG_PREFIX = 'lora:';
export const VAE_TAG_PREFIX = 'vae:';

/** Maps comfyui-models-lister.ts category names to their routing tag prefix. */
export const COMFYUI_CATEGORY_TAG_PREFIXES: Record<string, string> = {
  Checkpoints: CHECKPOINT_TAG_PREFIX,
  LoRAs: LORA_TAG_PREFIX,
  VAE: VAE_TAG_PREFIX,
  'Upscale Models': 'upscale_model:',
  ControlNet: 'controlnet:',
  Embeddings: 'embedding:',
  Clip: 'clip:',
  UNET: 'unet:',
  'Style Models': 'style_model:',
};

/**
 * Extract model requirement tags from a job context for routing.
 * LLM: model name from context.model.
 * IMAGE_GENERATION: checkpoint, LoRA, VAE names from workflow JSON nodes.
 * Other categories: [].
 */
export function extractJobModelTags(context: JobContext): string[] {
  if (isLLMJobContext(context) && context.model?.trim()) {
    return [`${MODEL_TAG_PREFIX}${context.model.trim()}`];
  }
  if (isImageGenerationJobContext(context) && context.workflow?.trim()) {
    return extractWorkflowModelTags(context.workflow);
  }
  return [];
}

function extractWorkflowModelTags(workflowStr: string): string[] {
  const tags: string[] = [];
  try {
    const parsed =
      typeof workflowStr === 'string' ? JSON.parse(workflowStr) : workflowStr;
    const nodes = parsed?.nodes ?? parsed;
    if (!nodes || typeof nodes !== 'object') return tags;
    const nodeList = Array.isArray(nodes) ? nodes : (Object.values(nodes) as Record<string, unknown>[]);
    for (const node of nodeList) {
      const classType = (node?.class_type ?? node?.type) as string | undefined;
      const inputs = (node?.inputs as Record<string, unknown>) ?? {};
      const widgetsValues = Array.isArray(node?.widgets_values) ? (node.widgets_values as unknown[]) : [];
      if (!classType) continue;
      if (
        classType === 'CheckpointLoaderSimple' ||
        classType === 'CheckpointLoader'
      ) {
        const name = (inputs.ckpt_name ?? widgetsValues[0]) as string | undefined;
        if (typeof name === 'string' && name.trim())
          tags.push(`${CHECKPOINT_TAG_PREFIX}${name.trim()}`);
      } else if (classType === 'LoRALoader' || classType === 'LoRA') {
        const name = (inputs.lora_name ?? widgetsValues[0]) as string | undefined;
        if (typeof name === 'string' && name.trim())
          tags.push(`${LORA_TAG_PREFIX}${name.trim()}`);
      } else if (classType === 'VAELoader') {
        const name = (inputs.vae_name ?? widgetsValues[0]) as string | undefined;
        if (typeof name === 'string' && name.trim())
          tags.push(`${VAE_TAG_PREFIX}${name.trim()}`);
      }
    }
  } catch {
    return [];
  }
  return tags;
}
import { ENGINE_CONFIG } from './config';

/**
 * Create a job context from form data
 */
export function createJobContextFromFormData(
  formData: Record<string, unknown>
): JobContext {
  const baseContext: BaseJobContext = {
    requirements:
      formData.requirements || formData.llmRequirements
        ? String(formData.requirements || formData.llmRequirements)
        : undefined,
    company: formData.company ? String(formData.company) : undefined,
  };

  switch (String(formData.category)) {
    case 'llm': {
      const numCtx =
        formData.llmNumCtx !== undefined && formData.llmNumCtx !== ''
          ? Number(formData.llmNumCtx)
          : undefined;
      const numPredict =
        formData.llmNumPredict !== undefined && formData.llmNumPredict !== ''
          ? Number(formData.llmNumPredict)
          : undefined;
      const thinkRaw = formData.llmThink;
      const think =
        thinkRaw === undefined || thinkRaw === ''
          ? undefined
          : thinkRaw === true || thinkRaw === 'true'
            ? true
            : thinkRaw === false || thinkRaw === 'false'
              ? false
              : (String(thinkRaw) as LLMThinkLevel);
      const topP =
        formData.llmTopP !== undefined && formData.llmTopP !== ''
          ? Number(formData.llmTopP)
          : undefined;
      const topK =
        formData.llmTopK !== undefined && formData.llmTopK !== ''
          ? Number(formData.llmTopK)
          : undefined;
      const repeatPenalty =
        formData.llmRepeatPenalty !== undefined &&
        formData.llmRepeatPenalty !== ''
          ? Number(formData.llmRepeatPenalty)
          : undefined;
      const seed =
        formData.llmSeed !== undefined && formData.llmSeed !== ''
          ? Number(formData.llmSeed)
          : undefined;
      return {
        ...baseContext,
        category: JobCategory.LLM,
        model: String(formData.llmModel || ''),
        temperature: Number(formData.llmTemperature) || 0.7,
        outputType: formData.outputType
          ? (String(formData.outputType) as 'text' | 'image' | 'artifact')
          : undefined,
        ...(numCtx !== undefined && !Number.isNaN(numCtx) && { numCtx }),
        ...(numPredict !== undefined && !Number.isNaN(numPredict) && { numPredict }),
        ...(think !== undefined && { think }),
        ...(topP !== undefined && !Number.isNaN(topP) && { topP }),
        ...(topK !== undefined && !Number.isNaN(topK) && { topK }),
        ...(repeatPenalty !== undefined &&
          !Number.isNaN(repeatPenalty) && { repeatPenalty }),
        ...(seed !== undefined && !Number.isNaN(seed) && Number.isInteger(seed) && { seed }),
      };
    }

    case 'script':
      return {
        ...baseContext,
        category: JobCategory.SCRIPT,
        scriptContent: String(formData.scriptContent || ''),
        language: String(formData.scriptLanguage || 'python'),
        timeout: Number(formData.scriptTimeout) || 300,
        workingDirectory: formData.scriptWorkingDirectory
          ? String(formData.scriptWorkingDirectory)
          : undefined,
        environment: formData.scriptEnvironment
          ? JSON.parse(String(formData.scriptEnvironment))
          : undefined,
        dependencies: formData.scriptDependencies
          ? JSON.parse(String(formData.scriptDependencies))
          : undefined,
        outputType: formData.outputType
          ? (String(formData.outputType) as 'text' | 'image' | 'artifact')
          : undefined,
      };

    case 'image_generation':
      return {
        ...baseContext,
        category: JobCategory.IMAGE_GENERATION,
        prompt: String(formData.imagePrompt || ''),
        negativePrompt: formData.imageNegativePrompt
          ? String(formData.imageNegativePrompt)
          : undefined,
        seed: formData.imageSeed ? Number(formData.imageSeed) : undefined,
        workflow: String(formData.imageWorkflow || ''),
        outputType: formData.outputType
          ? (String(formData.outputType) as 'text' | 'image' | 'artifact')
          : undefined,
      };

    case 'http_request': {
      let headers: Record<string, string> | undefined;
      if (formData.httpHeaders && String(formData.httpHeaders).trim()) {
        try {
          headers = JSON.parse(String(formData.httpHeaders));
        } catch (_error) {
          // Invalid JSON for headers, will be caught by validation
          headers = undefined;
        }
      }

      return {
        ...baseContext,
        category: JobCategory.HTTP_REQUEST,
        url: String(formData.httpUrl || ''),
        method:
          (formData.httpMethod as
            | 'GET'
            | 'POST'
            | 'PUT'
            | 'DELETE'
            | 'PATCH'
            | 'HEAD'
            | 'OPTIONS') || 'GET',
        headers,
        body:
          formData.httpBody && String(formData.httpBody).trim()
            ? String(formData.httpBody)
            : undefined,
        timeout: formData.httpTimeout
          ? Number(formData.httpTimeout)
          : undefined,
        outputType: formData.outputType
          ? (String(formData.outputType) as 'text' | 'image' | 'artifact')
          : undefined,
      };
    }

    case 'image':
      // Note: image data will be added by the backend controller from the uploaded file
      // For now, include a placeholder that will be replaced by the backend
      return {
        ...baseContext,
        category: JobCategory.IMAGE,
        operation:
          (formData.imageOperation as
            | 'resize'
            | 'crop'
            | 'grayscale'
            | 'adjust_contrast'
            | 'upscale'
            | 'merge') || 'resize',
        outputType: formData.outputType
          ? (String(formData.outputType) as 'text' | 'image' | 'artifact')
          : undefined,
        image: {
          fileName: '',
          mimeType: 'image/png',
          data: '',
        },
        parameters: {
          width: formData.imageWidth ? Number(formData.imageWidth) : undefined,
          height: formData.imageHeight
            ? Number(formData.imageHeight)
            : undefined,
          fit: formData.imageFit as
            | 'cover'
            | 'contain'
            | 'fill'
            | 'inside'
            | 'outside'
            | undefined,
          quality: formData.imageQuality
            ? Number(formData.imageQuality)
            : undefined,
          format:
            formData.imageFormat &&
            formData.imageFormat !== '' &&
            formData.imageFormat !== 'none'
              ? (formData.imageFormat as 'jpeg' | 'png' | 'webp' | 'avif')
              : undefined,
          x: formData.imageCropX ? Number(formData.imageCropX) : undefined,
          y: formData.imageCropY ? Number(formData.imageCropY) : undefined,
          contrast:
            formData.imageContrast !== undefined
              ? Number(formData.imageContrast)
              : undefined,
        },
      };

    default:
      throw new Error(`Unknown job category: ${formData.category}`);
  }
}

/**
 * Validate that a JobContext has all required fields for its category
 */
export function validateJobContext(context: JobContext): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (isLLMJobContext(context)) {
    if (!context.model) errors.push('Model is required for LLM jobs');
    if (context.temperature < 0 || context.temperature > 2) {
      errors.push('Temperature must be between 0 and 2');
    }
    if (
      context.numCtx !== undefined &&
      (context.numCtx <= 0 || context.numCtx > ENGINE_CONFIG.MAX_NUM_CTX)
    ) {
      errors.push(
        `numCtx must be between 1 and ${ENGINE_CONFIG.MAX_NUM_CTX}`
      );
    }
    if (context.numPredict !== undefined) {
      const n = context.numPredict;
      if (
        n !== -2 &&
        n !== -1 &&
        (typeof n !== 'number' || !Number.isInteger(n) || n < 1)
      ) {
        errors.push(
          'numPredict must be -2, -1, or a positive integer'
        );
      }
    }
  } else if (isScriptJobContext(context)) {
    if (!context.scriptContent || context.scriptContent.trim() === '') {
      errors.push('Script content is required for script jobs');
    }
    if (!context.language) errors.push('Language is required for script jobs');
  } else if (isImageGenerationJobContext(context)) {
    if (!context.prompt || context.prompt.trim() === '') {
      errors.push('Prompt is required for image generation jobs');
    }
    if (!context.workflow || context.workflow.trim() === '') {
      errors.push('Workflow is required for image generation jobs');
    }
  } else if (isHttpRequestJobContext(context)) {
    if (!context.url || context.url.trim() === '') {
      errors.push('URL is required for HTTP request jobs');
    }
    if (!context.method) {
      errors.push('Method is required for HTTP request jobs');
    }
    if (context.timeout && context.timeout < 0) {
      errors.push('Timeout must be a positive number');
    }
    // Note: headers and body are optional, no validation needed
  } else if (isImageJobContext(context)) {
    if (!context.operation) {
      errors.push('Operation is required for image jobs');
    }
    if (!context.image || !context.image.data) {
      errors.push('Image data is required for image jobs');
    }
    if (context.operation === 'resize' || context.operation === 'upscale') {
      if (!context.parameters?.width && !context.parameters?.height) {
        errors.push(
          'Width or height is required for resize/upscale operations'
        );
      }
    }
    if (context.operation === 'crop') {
      if (!context.parameters?.width || !context.parameters?.height) {
        errors.push('Width and height are required for crop operation');
      }
    }
    if (context.operation === 'merge') {
      if (!context.overlayImage || !context.overlayImage.data) {
        errors.push('Overlay image is required for merge operation');
      }
      if (!context.parameters?.width || !context.parameters?.height) {
        errors.push('Width and height are required for merge operation');
      }
    }
    if (context.operation === 'adjust_contrast') {
      if (context.parameters?.contrast === undefined) {
        errors.push('Contrast value is required for adjust_contrast operation');
      }
      if (
        context.parameters?.contrast !== undefined &&
        (context.parameters.contrast < -100 ||
          context.parameters.contrast > 100)
      ) {
        errors.push('Contrast must be between -100 and 100');
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
