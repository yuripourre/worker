import { ExecutableJob, ExecutableJobResult } from '../../types';
import { LLMClient } from '../../llm-client';
import { CategoryExecutor } from './category-executor';
import { ComfyUIWorkflowParser, WorkflowAnalysis } from '../../../lib/comfyui/workflow-parser';
import { ComfyUIModelChecker } from '../../../lib/comfyui/model-checker';
import { ComfyUIClient } from '../../../lib/comfyui/comfyui-client';
import { OutputArtifactHelper } from '../output-artifact-helper';
import { isImageGenerationJobContext, EXTERNAL_SERVICES_CONFIG } from '../../../shared';

/**
 * Image Generation Category Executor.
 * Performs image generation jobs (workflow or queue mode).
 */
export class ImageGenerationCategoryExecutor implements CategoryExecutor {
  private modelChecker: ComfyUIModelChecker;

  constructor(
    private llmClient: LLMClient,
    private baseUrl?: string,
    private deviceId?: string,
    private workerId?: string
  ) {
    this.modelChecker = new ComfyUIModelChecker();
  }

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isImageGenerationJobContext(job.context)) {
      throw new Error('Image generation context is required for image generation jobs');
    }
    const imageContext = job.context;

    try {
      // Check if this is queue mode
      const isQueueMode = imageContext.queueMode === true;

      if (isQueueMode) {
        // Queue mode: submit to ComfyUI and get prompt_id back
        const result = await this.generateImageQueueMode(job.id, imageContext);
        return result;
      }

      // Traditional workflow mode: verify dependencies first
      if (!imageContext.workflow) {
        return {
          status: 'failed',
          answer: 'Either workflow or queueMode with extra_data is required for image generation'
        };
      }

      let workflowData;
      try {
        workflowData = typeof imageContext.workflow === 'string'
          ? JSON.parse(imageContext.workflow)
          : imageContext.workflow;
      } catch (error) {
        return {
          status: 'failed',
          answer: `Invalid workflow format: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
      }

      const workflowAnalysis = ComfyUIWorkflowParser.parseWorkflow(workflowData);
      const areAllAvailable = await this.modelChecker.areAllDependenciesAvailable(workflowAnalysis.dependencies);

      if (!areAllAvailable) {
        const missingDeps = await this.modelChecker.getMissingDependencies(workflowAnalysis.dependencies);
        return {
          status: 'waiting',
          answer: `Cannot execute: ${missingDeps.length} dependencies are still missing. Please ensure all required models and LoRAs are available.`
        };
      }

      // Generate image using appropriate tools/APIs
      const result = await this.generateImage(job.id, imageContext, workflowData);

      const comfyUIUrl = process.env.COMFYUI_URL || EXTERNAL_SERVICES_CONFIG.DEFAULT_COMFYUI_BASE_URL;
      const uploadedInputImages = result.metadata?.inputImages || [];

      const execResult: ExecutableJobResult = {
        status: 'success',
        answer: `Image generated successfully using ComfyUI workflow.

Prompt: ${imageContext.prompt}
Negative Prompt: ${imageContext.negativePrompt || 'None'}
Seed: ${imageContext.seed || 'Random'}

Generated Image Details:
- File Name: ${result.fileName}
- File Size: ${result.fileSize} bytes
- Format: ${result.format}
- Dimensions: ${result.dimensions}
- Generation Time: ${result.generationTime}ms

Workflow Analysis:
${ComfyUIWorkflowParser.createSummary(workflowAnalysis)}

${uploadedInputImages.length > 0 ? `\nInput Images: ${uploadedInputImages.length} image(s) used\n${uploadedInputImages.map((img: any, idx: number) => `  ${idx + 1}. ${img.filename} (${img.subfolder}/${img.type})`).join('\n')}` : ''}

${result.metadata ? `Metadata: ${JSON.stringify(result.metadata, null, 2)}` : ''}`
      };

      // Add artifact if image was generated and saved
      if (result.artifact) {
        execResult.artifacts = [result.artifact];
      }

      // Add execution details with uploaded image information
      if (uploadedInputImages.length > 0 || result.metadata) {
        execResult.executionDetails = {
          uploadedInputImages: uploadedInputImages.length > 0 ? uploadedInputImages.map((img: any) => ({
            name: img.filename,
            subfolder: img.subfolder,
            type: img.type,
            comfyUIUrl: `${comfyUIUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`
          })) : undefined,
          generatedImage: {
            filename: result.fileName,
            fileSize: result.fileSize,
            format: result.format,
            dimensions: result.dimensions,
            comfyUIUrl: `${comfyUIUrl}/view?filename=${encodeURIComponent(result.fileName)}`
          },
          metadata: result.metadata
        };
      }

      return execResult;
    } catch (error) {
      return {
        status: 'failed',
        answer: `Image generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Generate image using queue mode (new ComfyUI queue endpoint approach)
   */
  private async generateImageQueueMode(
    jobId: string,
    imageContext: any
  ): Promise<ExecutableJobResult> {
    const startTime = Date.now();

    try {
      const comfyUIUrl = process.env.COMFYUI_URL || EXTERNAL_SERVICES_CONFIG.DEFAULT_COMFYUI_BASE_URL;
      const comfyUIClient = new ComfyUIClient({ baseUrl: comfyUIUrl });

      // Check if ComfyUI is available
      const isComfyUIAvailable = await comfyUIClient.checkHealth().catch(() => false);

      if (!isComfyUIAvailable) {
        return {
          status: 'failed',
          answer: 'ComfyUI is not available. Please ensure ComfyUI is running and accessible.'
        };
      }

      // Upload input images if provided
      const uploadedImages: Array<{ name: string; subfolder: string; type: string }> = [];
      if (imageContext.inputImages && imageContext.inputImages.length > 0) {
        for (const inputImage of imageContext.inputImages) {
          try {
            // Decode base64 image data
            const imageBuffer = Buffer.from(inputImage.data, 'base64');
            const fileName = inputImage.fileName || `input-${Date.now()}.png`;

            // Upload to ComfyUI
            const uploadResult = await comfyUIClient.uploadImage(
              imageBuffer,
              fileName,
              'input',
              true
            );
            uploadedImages.push(uploadResult);
          } catch (error) {
            console.error(`Failed to upload input image ${inputImage.fileName}:`, error);
            // Continue with other images even if one fails
          }
        }
      }

      // Build the prompt data from context fields
      // Use prompt as positive, negativePrompt as negative, and seed from context
      const promptData: Record<string, any> = {};

      // Add basic inputs from context
      if (imageContext.seed !== undefined) {
        promptData.seed = imageContext.seed;
      }
      if (imageContext.prompt) {
        promptData.positive = imageContext.prompt;
      }
      if (imageContext.negativePrompt) {
        promptData.negative = imageContext.negativePrompt;
      }

      // Add input images to prompt data if available
      if (uploadedImages.length > 0) {
        promptData.inputImages = uploadedImages.map(img => ({
          filename: img.name,
          subfolder: img.subfolder,
          type: img.type
        }));
      }

      // Build extra_data dynamically from context fields
      const extraData = {
        inputs: promptData
      };

      // Use provided promptId or generate client_id
      const clientId = imageContext.promptId || `job-${jobId}`;

      // Queue the prompt to ComfyUI
      const queueResult = await comfyUIClient.queuePrompt({
        prompt: promptData,
        extra_data: extraData,
        client_id: clientId
      });

      const promptId = queueResult.prompt_id;

      // Update the job context with the prompt_id returned from ComfyUI
      imageContext.promptId = promptId;

      // If the user already provided a prompt_id, we might just want to check status
      // Otherwise, wait for completion
      const completionResult = await comfyUIClient.waitForPromptCompletion(promptId);

      if (completionResult.status === 'failed') {
        return {
          status: 'failed',
          answer: `Image generation failed: ${completionResult.error || 'Unknown error'}`
        };
      }

      // Get the generated image
      const images = completionResult.images || [];
      if (images.length === 0) {
        return {
          status: 'failed',
          answer: 'No images were generated by ComfyUI'
        };
      }

      const firstImage = images[0];
      const generatedFilename = firstImage.filename;

      // Download the generated image from ComfyUI
      const imageUrl = `${comfyUIUrl}/view?filename=${encodeURIComponent(generatedFilename)}`;
      const imageResponse = await fetch(imageUrl);

      if (!imageResponse.ok) {
        throw new Error(`Failed to download generated image: HTTP ${imageResponse.status}`);
      }

      // Get image as buffer
      const arrayBuffer = await imageResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Determine MIME type from response or filename
      const contentType = imageResponse.headers.get('content-type') || 'image/png';
      const mimeType = contentType.includes('image/') ? contentType : 'image/png';

      // Convert to base64 for artifact creation
      const base64Image = buffer.toString('base64');

      // Create artifact using helper
      const artifact = await OutputArtifactHelper.createImageArtifact(
        jobId,
        base64Image,
        this.workerId || 'unknown',
        mimeType
      );

      const generationTime = Date.now() - startTime;

      const inputImagesInfo = uploadedImages.length > 0
        ? `\nInput Images: ${uploadedImages.length} image(s) uploaded\n${uploadedImages.map((img, idx) => `  ${idx + 1}. ${img.name} (${img.subfolder}/${img.type})`).join('\n')}`
        : '';

      return {
        status: 'success',
        answer: `Image generated successfully using ComfyUI queue mode.

Prompt (Positive): ${imageContext.prompt}
Negative Prompt: ${imageContext.negativePrompt || 'None'}
Seed: ${imageContext.seed || 'Random'}
Prompt ID: ${promptId}
Queue Number: ${queueResult.number}${inputImagesInfo}

Generated Image Details:
- File Name: ${generatedFilename}
- File Size: ${buffer.length} bytes
- Format: ${mimeType.split('/')[1]?.toUpperCase() || 'PNG'}
- Generation Time: ${generationTime}ms`,
        artifacts: [artifact],
        executionDetails: {
          uploadedInputImages: uploadedImages.length > 0 ? uploadedImages.map(img => ({
            name: img.name,
            subfolder: img.subfolder,
            type: img.type,
            comfyUIUrl: `${comfyUIUrl}/view?filename=${encodeURIComponent(img.name)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`
          })) : undefined,
          generatedImage: {
            filename: generatedFilename,
            fileSize: buffer.length,
            format: mimeType.split('/')[1]?.toUpperCase() || 'PNG',
            comfyUIUrl: `${comfyUIUrl}/view?filename=${encodeURIComponent(generatedFilename)}`
          },
          promptId,
          queueNumber: queueResult.number
        }
      };
    } catch (error) {
      return {
        status: 'failed',
        answer: `Image generation failed in queue mode: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private async generateImage(
    jobId: string,
    imageContext: any,
    workflowData: any
  ): Promise<{
    fileName: string;
    fileSize: number;
    format: string;
    dimensions: string;
    generationTime: number;
    metadata?: any;
    artifact?: any;
  }> {
    const startTime = Date.now();

    try {
      // Try to use ComfyUI if available
      // Default ComfyUI URL - can be configured via environment or config
      const comfyUIUrl = process.env.COMFYUI_URL || EXTERNAL_SERVICES_CONFIG.DEFAULT_COMFYUI_BASE_URL;
      const comfyUIClient = new ComfyUIClient({ baseUrl: comfyUIUrl });

      // Check if ComfyUI is available
      const isComfyUIAvailable = await comfyUIClient.checkHealth().catch(() => false);

      if (isComfyUIAvailable && workflowData) {
        // Parse the workflow data if it's a string
        const parsedWorkflow = typeof workflowData === 'string'
          ? JSON.parse(workflowData)
          : workflowData;

        // Upload input images if provided
        const uploadedImages: Array<{ name: string; subfolder: string; type: string }> = [];
        if (imageContext.inputImages && imageContext.inputImages.length > 0) {
          for (const inputImage of imageContext.inputImages) {
            try {
              // Decode base64 image data
              const imageBuffer = Buffer.from(inputImage.data, 'base64');
              const fileName = inputImage.fileName || `input-${Date.now()}.png`;

              // Upload to ComfyUI
              const uploadResult = await comfyUIClient.uploadImage(
                imageBuffer,
                fileName,
                'input',
                true
              );
              uploadedImages.push(uploadResult);
            } catch (error) {
              console.error(`Failed to upload input image ${inputImage.fileName}:`, error);
              // Continue with other images even if one fails
            }
          }
        }

        // Convert frontend format to API format
        const apiNodes = ComfyUIWorkflowParser.convertFrontendToAPI(parsedWorkflow);

        // Inject uploaded images into LoadImage nodes if available
        if (uploadedImages.length > 0) {
          let imageIndex = 0;
          for (const [nodeId, node] of Object.entries(apiNodes)) {
            const nodeData = node as any;
            // Check if this is a LoadImage node
            if (nodeData.class_type === 'LoadImage' && imageIndex < uploadedImages.length) {
              const uploadedImage = uploadedImages[imageIndex];
              // Update the node to use the uploaded image
              if (!nodeData.inputs) {
                nodeData.inputs = {};
              }
              // ComfyUI LoadImage node expects image in format:
              // - String: "filename.png" (for default input folder)
              // - Array: ["filename.png", "subfolder"] (for subfolder)
              // Since we upload to 'input' subfolder, we use the array format
              if (uploadedImage.subfolder && uploadedImage.subfolder !== 'input') {
                nodeData.inputs.image = [uploadedImage.name, uploadedImage.subfolder];
              } else {
                // For default input folder, use array format with 'input' subfolder
                nodeData.inputs.image = [uploadedImage.name, 'input'];
              }
              imageIndex++;
            }
          }
        }

        // Execute workflow using ComfyUI
        const workflow: any = {
          id: `workflow-${Date.now()}`,
          name: 'Image Generation',
          nodes: apiNodes
        };

        // Execute the workflow
        const generatedFilename = await comfyUIClient.executeWorkflow(workflow);

        // Download the generated image from ComfyUI
        // ComfyUI serves images at /view endpoint
        const imageUrl = `${comfyUIUrl}/view?filename=${encodeURIComponent(generatedFilename)}`;
        const imageResponse = await fetch(imageUrl);

        if (!imageResponse.ok) {
          throw new Error(`Failed to download generated image: HTTP ${imageResponse.status}`);
        }

        // Get image as buffer
        const arrayBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Determine MIME type from response or filename
        const contentType = imageResponse.headers.get('content-type') || 'image/png';
        const mimeType = contentType.includes('image/') ? contentType : 'image/png';

        // Convert to base64 for artifact creation
        const base64Image = buffer.toString('base64');

        // Create artifact using helper
        const artifact = await OutputArtifactHelper.createImageArtifact(
          jobId,
          base64Image,
          this.workerId || 'unknown',
          mimeType
        );

        const generationTime = Date.now() - startTime;

        // Get image dimensions if possible (would need image processing library)
        const dimensions = 'Unknown'; // Could use sharp or similar to get actual dimensions

        const metadata: any = {
          prompt: imageContext.prompt,
          negativePrompt: imageContext.negativePrompt,
          seed: imageContext.seed,
          workflow: imageContext.workflow,
          generationMethod: 'ComfyUI',
          timestamp: new Date().toISOString(),
          comfyUIUrl
        };

        // Add input images info to metadata
        if (uploadedImages.length > 0) {
          metadata.inputImages = uploadedImages.map(img => ({
            filename: img.name,
            subfolder: img.subfolder,
            type: img.type
          }));
        }

        return {
          fileName: generatedFilename,
          fileSize: buffer.length,
          format: mimeType.split('/')[1]?.toUpperCase() || 'PNG',
          dimensions,
          generationTime,
          artifact,
          metadata
        };
      } else {
        // ComfyUI not available or no workflow - create a placeholder artifact
        // This is useful for testing or when ComfyUI is not configured
        console.warn('ComfyUI not available or workflow invalid, creating placeholder artifact');

        // Create a simple placeholder image (1x1 transparent PNG)
        const placeholderImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

        const artifact = await OutputArtifactHelper.createImageArtifact(
          jobId,
          placeholderImageBase64,
          this.workerId || 'unknown',
          'image/png'
        );

        const generationTime = Date.now() - startTime;

        return {
          fileName: `placeholder_${Date.now()}.png`,
          fileSize: Buffer.from(placeholderImageBase64, 'base64').length,
          format: 'PNG',
          dimensions: '1x1',
          generationTime,
          artifact,
          metadata: {
            prompt: imageContext.prompt,
            negativePrompt: imageContext.negativePrompt,
            seed: imageContext.seed,
            workflow: imageContext.workflow,
            generationMethod: 'Placeholder',
            timestamp: new Date().toISOString(),
            note: 'ComfyUI not available - placeholder image created'
          }
        };
      }
    } catch (error) {
      console.error('Image generation error:', error);
      throw new Error(`Failed to generate image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
