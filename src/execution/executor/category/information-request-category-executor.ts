import { ExecutableJob, ExecutableJobResult } from '../../types';
import { CategoryExecutor } from './category-executor';
import { InformationRequestJobContext, isInformationRequestJobContext, ModelInventory } from '../../../shared';
import { OllamaClient } from '../../../services/ollama-client';
import { listComfyUIModels } from '../../../utils/comfyui-models-lister';

/**
 * Information Request Category Executor
 * Handles jobs that request system information from the worker
 */
export class InformationRequestCategoryExecutor implements CategoryExecutor {
  constructor(
    private baseUrl?: string,
    private deviceId?: string,
    private workerId?: string,
    private ollamaBaseUrl?: string,
    private comfyuiPath?: string
  ) {}

  async executePlan(job: ExecutableJob): Promise<ExecutableJobResult> {
    // Information requests don't need planning
    return {
      status: 'success',
      answer: 'Information request plan completed'
    };
  }

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    const context = job.context;

    if (!isInformationRequestJobContext(context)) {
      throw new Error('Invalid job context for information request');
    }

    try {
      let informationData: any = {};

      switch (context.informationType) {
        case 'ollama_models':
          informationData = await this.getOllamaModels();
          break;
        case 'comfyui_models':
          informationData = await this.getComfyUIModels();
          break;
        case 'all_models':
          informationData = {
            ollamaModels: await this.getOllamaModels(),
            comfyuiModels: await this.getComfyUIModels()
          };
          break;
        case 'capabilities':
          informationData = await this.getCapabilities();
          break;
        case 'system_info':
          informationData = await this.getSystemInfo();
          break;
        default:
          throw new Error(`Unknown information type: ${context.informationType}`);
      }

      // If updateInventory is true, send the information to update the device inventory
      if (context.updateInventory) {
        if (!this.baseUrl) {
          console.error('❌ Cannot update device inventory: baseUrl is not configured');
          console.error('   Worker needs to be started with server URL to update inventory');
        } else if (!this.deviceId) {
          console.error('❌ Cannot update device inventory: deviceId is not configured');
          console.error('   Worker needs to register with server to get deviceId');
        } else {
          console.log(`📤 Updating device inventory for device: ${this.deviceId}`);
          await this.updateDeviceInventory(informationData);
        }
      } else {
        console.log('ℹ️ Skipping inventory update (updateInventory is false)');
      }

      return {
        status: 'success',
        answer: JSON.stringify(informationData, null, 2)

      };
    } catch (error) {
      return {
        status: 'failed',
        answer: `Failed to collect information: ${error instanceof Error ? error.message : 'Unknown error'}`

      };
    }
  }

  async executeReview(job: ExecutableJob, childAnswers: Map<string, string>): Promise<ExecutableJobResult> {
    // Information requests don't need review
    return {
      status: 'success',
      answer: 'Information request review completed'
    };
  }

  /**
   * Get Ollama models
   */
  private async getOllamaModels(): Promise<any> {
    try {
      const ollamaClient = new OllamaClient({
        baseUrl: this.ollamaBaseUrl || 'http://localhost:11434'
      });

      const status = await ollamaClient.checkStatus();
      if (!status.isRunning) {
        return {
          available: false,
          error: `Ollama is not running at ${status.baseUrl}`
        };
      }

      const models = await ollamaClient.listModels();
      return {
        available: true,
        baseUrl: status.baseUrl,
        version: status.version,
        models: models.map(m => ({
          name: m.name,
          size: m.size,
          modified_at: m.modified_at,
          digest: m.digest
        }))
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get ComfyUI models
   */
  private async getComfyUIModels(): Promise<any> {
    try {
      // Note: listComfyUIModels will append '/models' if comfyuiPath is provided
      const comfyuiBasePath = this.comfyuiPath || process.env.COMFYUI_MODELS_PATH;
      if (!comfyuiBasePath) {
      return {
        available: false,
        error: 'ComfyUI path not configured. Please set comfyuiPath or COMFYUI_MODELS_PATH environment variable.'
      };
      }

      const data = await listComfyUIModels(this.comfyuiPath || process.env.COMFYUI_MODELS_PATH);
      return {
        available: true,
        categories: data.categories.map((cat: any) => ({
          name: cat.name,
          path: cat.path,
          fileCount: cat.files.length,
          files: cat.files.map((file: any) => ({
            name: file.name,
            size: file.size,
            modified: file.modified,
            path: file.path
          }))
        }))
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get capabilities
   */
  private async getCapabilities(): Promise<any> {
    try {
      const { capabilityAvailabilityChecker } = await import('../../../utils/tool-availability-checker');
      const { registerAllCapabilityCheckers } = await import('../../../services/tool-checkers');

      // Register checkers
      registerAllCapabilityCheckers(
        this.ollamaBaseUrl || 'http://localhost:11434',
        'http://localhost:8188'
      );

      const capabilityStatus = await capabilityAvailabilityChecker.getCapabilityStatus();

      return {
        available: capabilityStatus.available,
        unavailable: capabilityStatus.unavailable
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get system information
   */
  private async getSystemInfo(): Promise<any> {
    const { hostname, platform, arch, cpus, totalmem, freemem } = await import('os');

    return {
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      cpus: cpus().length,
      totalMemory: totalmem(),
      freeMemory: freemem(),
      uptime: process.uptime()
    };
  }

  /**
   * Update device inventory on the server
   */
  private async updateDeviceInventory(informationData: any): Promise<void> {
    try {
      console.log('🔄 updateDeviceInventory called with data:', JSON.stringify(informationData, null, 2));

      const modelInventory: ModelInventory = {
        lastUpdated: new Date().toISOString()
      };

      // Handle data from all_models request (wrapped format)
      if (informationData.ollamaModels) {
        if (informationData.ollamaModels.available && informationData.ollamaModels.models) {
          modelInventory.ollamaModels = informationData.ollamaModels.models;
          console.log(`📦 Setting ollamaModels from wrapped format: ${informationData.ollamaModels.models.length} models`);
        }
      }

      if (informationData.comfyuiModels) {
        if (informationData.comfyuiModels.available && informationData.comfyuiModels.categories) {
          modelInventory.comfyuiModels = informationData.comfyuiModels.categories;
          console.log(`📦 Setting comfyuiModels from wrapped format: ${informationData.comfyuiModels.categories.length} categories`);
        }
      }

      // Handle direct data from single-type requests (ollama_models or comfyui_models)
      // For ollama_models: informationData = { available, baseUrl, version, models }
      // Check if this is direct Ollama data (has 'available' property)
      if (informationData.available !== undefined) {
        // This is direct Ollama data
        if (informationData.available && informationData.models && Array.isArray(informationData.models)) {
          modelInventory.ollamaModels = informationData.models;
          console.log(`📦 Setting ollamaModels from direct format: ${informationData.models.length} models`);
        } else if (!informationData.available) {
          // Clear models if Ollama is not available
          modelInventory.ollamaModels = [];
          console.log(`📦 Clearing ollamaModels because Ollama is not available`);
        }
      }

      // For comfyui_models: informationData = { available, categories }
      if (informationData.available !== undefined && informationData.categories) {
        // This is direct ComfyUI data
        if (informationData.available && informationData.categories) {
          modelInventory.comfyuiModels = informationData.categories;
          console.log(`📦 Setting comfyuiModels from direct format: ${informationData.categories.length} categories`);
        }
      }

      console.log('📤 Sending modelInventory to server:', JSON.stringify(modelInventory, null, 2));

      // Send update to server
      const response = await fetch(`${this.baseUrl}/api/devices/${this.deviceId}/inventory`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ modelInventory })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to update device inventory: ${response.statusText}`, errorText);
      } else {
        const responseData = await response.json();
        console.log('✅ Device inventory updated successfully, response:', responseData);
      }
    } catch (error) {
      console.error('❌ Error updating device inventory:', error);
    }
  }
}

