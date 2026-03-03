import { ExecutableJob, ExecutableJobResult } from '../../types';
import { CategoryExecutor } from './category-executor';
import { ModelManagementJobContext, isModelManagementJobContext, ModelInventory } from '../../../shared';
import { OllamaClient } from '../../../services/ollama-client';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Model Management Category Executor
 * Handles installation and removal of Ollama and ComfyUI models
 */
export class ModelManagementCategoryExecutor implements CategoryExecutor {
  constructor(
    private baseUrl?: string,
    private deviceId?: string,
    private workerId?: string,
    private ollamaBaseUrl?: string,
    private comfyuiPath?: string
  ) {}

  async executePlan(job: ExecutableJob): Promise<ExecutableJobResult> {
    // Model management doesn't need planning
    return {
      status: 'success',
      answer: 'Model management plan completed'
    };
  }

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    const context = job.context;

    if (!isModelManagementJobContext(context)) {
      throw new Error('Invalid job context for model management');
    }

    try {
      let result: any;

      switch (context.service) {
        case 'ollama':
          result = await this.handleOllamaOperation(context);
          break;
        case 'comfyui':
          result = await this.handleComfyUIOperation(context);
          break;
        default:
          throw new Error(`Unknown service: ${context.service}`);
      }

      // If updateInventory is true, update the device inventory
      if (context.updateInventory && this.baseUrl && this.deviceId) {
        await this.updateDeviceInventory();
      }

      return {
        status: 'success',
        answer: JSON.stringify(result, null, 2)

      };
    } catch (error) {
      return {
        status: 'failed',
        answer: `Model management failed: ${error instanceof Error ? error.message : 'Unknown error'}`

      };
    }
  }

  async executeReview(job: ExecutableJob, childAnswers: Map<string, string>): Promise<ExecutableJobResult> {
    // Model management doesn't need review
    return {
      status: 'success',
      answer: 'Model management review completed'
    };
  }

  /**
   * Handle Ollama operations
   */
  private async handleOllamaOperation(context: ModelManagementJobContext): Promise<any> {
    const ollamaClient = new OllamaClient({
      baseUrl: this.ollamaBaseUrl || 'http://localhost:11434'
    });

    // Check if Ollama is running
    const status = await ollamaClient.checkStatus();
    if (!status.isRunning) {
      throw new Error(`Ollama is not running at ${status.baseUrl}`);
    }

    switch (context.operation) {
      case 'install':
        console.log(`📥 Installing Ollama model: ${context.modelName}`);
        const installResult = await ollamaClient.pullModel(context.modelName);
        console.log(`✅ Ollama model installed: ${context.modelName}`);
        return {
          operation: 'install',
          service: 'ollama',
          modelName: context.modelName,
          success: true,
          message: installResult.message
        };

      case 'remove':
        console.log(`🗑️ Removing Ollama model: ${context.modelName}`);
        const removeResult = await ollamaClient.removeModel(context.modelName);
        console.log(`✅ Ollama model removed: ${context.modelName}`);
        return {
          operation: 'remove',
          service: 'ollama',
          modelName: context.modelName,
          success: true,
          message: removeResult.message
        };

      case 'update':
        console.log(`🔄 Updating Ollama model: ${context.modelName}`);
        // For Ollama, update is the same as pulling the latest version
        const updateResult = await ollamaClient.pullModel(context.modelName);
        console.log(`✅ Ollama model updated: ${context.modelName}`);
        return {
          operation: 'update',
          service: 'ollama',
          modelName: context.modelName,
          success: true,
          message: updateResult.message
        };

      default:
        throw new Error(`Unknown operation: ${context.operation}`);
    }
  }

  /**
   * Handle ComfyUI operations
   */
  private async handleComfyUIOperation(context: ModelManagementJobContext): Promise<any> {
    // If comfyuiPath is provided, models are in the 'models' subdirectory
    const comfyuiBasePath = this.comfyuiPath
      ? `${this.comfyuiPath}/models`
      : process.env.COMFYUI_MODELS_PATH;
    if (!comfyuiBasePath) {
      throw new Error('ComfyUI path not configured. Please set comfyuiPath or COMFYUI_MODELS_PATH environment variable.');
    }

    switch (context.operation) {
      case 'install':
        return await this.installComfyUIModel(context, comfyuiBasePath);

      case 'remove':
        return await this.removeComfyUIModel(context, comfyuiBasePath);

      case 'update':
        // For ComfyUI, update means remove and reinstall
        await this.removeComfyUIModel(context, comfyuiBasePath);
        return await this.installComfyUIModel(context, comfyuiBasePath);

      default:
        throw new Error(`Unknown operation: ${context.operation}`);
    }
  }

  /**
   * Install a ComfyUI model
   */
  private async installComfyUIModel(context: ModelManagementJobContext, basePath: string): Promise<any> {
    if (!context.modelUrl) {
      throw new Error('modelUrl is required for ComfyUI model installation');
    }

    if (!context.targetPath) {
      throw new Error('targetPath is required for ComfyUI model installation (e.g., "checkpoints", "loras", "vae")');
    }

    console.log(`📥 Installing ComfyUI model: ${context.modelName} to ${context.targetPath}`);

    // Construct the target directory
    const targetDir = join(basePath, context.targetPath);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // Determine file extension from URL or default to .safetensors
    const urlExt = context.modelUrl.split('.').pop()?.split('?')[0];
    const fileExt = urlExt && ['safetensors', 'ckpt', 'pt', 'pth', 'bin'].includes(urlExt) ? urlExt : 'safetensors';
    const fileName = context.modelName.endsWith(`.${fileExt}`) ? context.modelName : `${context.modelName}.${fileExt}`;
    const targetPath = join(targetDir, fileName);

    // Download the file
    console.log(`⬇️ Downloading from ${context.modelUrl}...`);
    const response = await fetch(context.modelUrl);
    if (!response.ok) {
      throw new Error(`Failed to download model: HTTP ${response.status} ${response.statusText}`);
    }

    // Get the file as an ArrayBuffer and write it
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`💾 Saving to ${targetPath}...`);
    await Bun.write(targetPath, buffer);

    const fileSizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
    console.log(`✅ ComfyUI model installed: ${fileName} (${fileSizeMB} MB)`);

    return {
      operation: 'install',
      service: 'comfyui',
      modelName: context.modelName,
      targetPath: context.targetPath,
      filePath: targetPath,
      fileSize: buffer.length,
      success: true,
      message: `Model ${fileName} installed successfully to ${context.targetPath} (${fileSizeMB} MB)`
    };
  }

  /**
   * Remove a ComfyUI model
   */
  private async removeComfyUIModel(context: ModelManagementJobContext, basePath: string): Promise<any> {
    if (!context.targetPath) {
      throw new Error('targetPath is required for ComfyUI model removal (e.g., "checkpoints", "loras", "vae")');
    }

    console.log(`🗑️ Removing ComfyUI model: ${context.modelName} from ${context.targetPath}`);

    // Construct the target path - try common extensions
    const targetDir = join(basePath, context.targetPath);
    const extensions = ['safetensors', 'ckpt', 'pt', 'pth', 'bin'];

    let removedPath: string | null = null;
    for (const ext of extensions) {
      const fileName = context.modelName.endsWith(`.${ext}`) ? context.modelName : `${context.modelName}.${ext}`;
      const filePath = join(targetDir, fileName);

      if (existsSync(filePath)) {
        const { unlinkSync } = await import('fs');
        unlinkSync(filePath);
        removedPath = filePath;
        console.log(`✅ ComfyUI model removed: ${fileName}`);
        break;
      }
    }

    if (!removedPath) {
      throw new Error(`Model ${context.modelName} not found in ${context.targetPath}`);
    }

    return {
      operation: 'remove',
      service: 'comfyui',
      modelName: context.modelName,
      targetPath: context.targetPath,
      filePath: removedPath,
      success: true,
      message: `Model ${context.modelName} removed successfully from ${context.targetPath}`
    };
  }

  /**
   * Update device inventory on the server
   */
  private async updateDeviceInventory(): Promise<void> {
    try {
      console.log('📦 Updating device inventory after model management...');

      // Collect fresh model inventory
      const { collectModelInventory } = await import('../../../utils/model-inventory-collector');
      const modelInventory = await collectModelInventory(
        this.ollamaBaseUrl,
        this.comfyuiPath
      );

      if (!modelInventory) {
        console.warn('⚠️ Could not collect model inventory');
        return;
      }

      // Send update to server
      const response = await fetch(`${this.baseUrl}/api/devices/${this.deviceId}/inventory`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ modelInventory })
      });

      if (!response.ok) {
        console.error(`Failed to update device inventory: ${response.statusText}`);
      } else {
        console.log('✅ Device inventory updated successfully');
      }
    } catch (error) {
      console.error('Error updating device inventory:', error);
    }
  }
}

