/**
 * ComfyUI Model Availability Checker
 * Checks if required models and LoRAs are available on the system
 */

import { WorkflowDependency } from './workflow-parser';

export interface ModelInfo {
  name: string;
  type: 'model' | 'lora' | 'vae' | 'upscaler' | 'controlnet' | 'embedding';
  path: string;
  size: number;
  available: boolean;
  lastModified?: string;
}

export interface ModelAvailabilityResult {
  available: ModelInfo[];
  missing: ModelInfo[];
  totalSize: number;
  availableSize: number;
}

export class ComfyUIModelChecker {
  private modelPaths: Map<string, string> = new Map();
  private availableModels: Set<string> = new Set();

  constructor(private basePath: string = '/models') {
    this.initializeModelPaths();
  }

  /**
   * Initialize common model paths
   */
  private initializeModelPaths(): void {
    this.modelPaths.set('models', `${this.basePath}/checkpoints`);
    this.modelPaths.set('loras', `${this.basePath}/loras`);
    this.modelPaths.set('vaes', `${this.basePath}/vae`);
    this.modelPaths.set('upscalers', `${this.basePath}/upscale_models`);
    this.modelPaths.set('controlnets', `${this.basePath}/controlnet`);
    this.modelPaths.set('embeddings', `${this.basePath}/embeddings`);
  }

  /**
   * Check availability of models and LoRAs
   */
  async checkAvailability(dependencies: WorkflowDependency[]): Promise<ModelAvailabilityResult> {
    const available: ModelInfo[] = [];
    const missing: ModelInfo[] = [];
    let totalSize = 0;
    let availableSize = 0;

    for (const dep of dependencies) {
      const modelInfo = await this.checkModelAvailability(dep);
      
      if (modelInfo.available) {
        available.push(modelInfo);
        availableSize += modelInfo.size;
      } else {
        missing.push(modelInfo);
      }
      
      totalSize += modelInfo.size;
    }

    return {
      available,
      missing,
      totalSize,
      availableSize
    };
  }

  /**
   * Check if a specific model is available
   */
  private async checkModelAvailability(dependency: WorkflowDependency): Promise<ModelInfo> {
    const modelPath = this.getModelPath(dependency);
    const fullPath = `${modelPath}/${dependency.name}`;
    
    try {
      // In a real implementation, this would check the file system
      // For now, we'll simulate the check
      const isAvailable = await this.simulateModelCheck(fullPath);
      
      return {
        name: dependency.name,
        type: dependency.type,
        path: fullPath,
        size: this.estimateModelSize(dependency),
        available: isAvailable,
        lastModified: isAvailable ? new Date().toISOString() : undefined
      };
    } catch (error) {
      return {
        name: dependency.name,
        type: dependency.type,
        path: fullPath,
        size: this.estimateModelSize(dependency),
        available: false
      };
    }
  }

  /**
   * Get the appropriate model path for a dependency type
   */
  private getModelPath(dependency: WorkflowDependency): string {
    return this.modelPaths.get(dependency.type + 's') || this.modelPaths.get('models') || this.basePath;
  }

  /**
   * Simulate model availability check
   * In a real implementation, this would check the file system
   */
  private async simulateModelCheck(path: string): Promise<boolean> {
    // Simulate some models being available
    const availableModels = [
      'v1-5-pruned.ckpt',
      'v1-5-pruned-emaonly.ckpt',
      'sd_xl_base_1.0.safetensors',
      'sd_xl_refiner_1.0.safetensors'
    ];

    const fileName = path.split('/').pop() || '';
    return availableModels.includes(fileName);
  }

  /**
   * Estimate model size based on type and name
   */
  private estimateModelSize(dependency: WorkflowDependency): number {
    const baseSizes: Record<string, number> = {
      'model': 4000000000, // 4GB for checkpoint models
      'lora': 100000000,   // 100MB for LoRAs
      'vae': 300000000,    // 300MB for VAEs
      'upscaler': 500000000, // 500MB for upscalers
      'controlnet': 1000000000, // 1GB for ControlNets
      'embedding': 1000000  // 1MB for embeddings
    };

    return baseSizes[dependency.type] || 100000000;
  }

  /**
   * Get all available models of a specific type
   */
  async getAvailableModels(type: string): Promise<ModelInfo[]> {
    const path = this.modelPaths.get(type + 's') || this.modelPaths.get('models') || this.basePath;
    
    // In a real implementation, this would scan the directory
    // For now, return mock data
    const mockModels: ModelInfo[] = [
      {
        name: 'v1-5-pruned.ckpt',
        type: 'model',
        path: `${path}/v1-5-pruned.ckpt`,
        size: 4000000000,
        available: true,
        lastModified: new Date().toISOString()
      },
      {
        name: 'sd_xl_base_1.0.safetensors',
        type: 'model',
        path: `${path}/sd_xl_base_1.0.safetensors`,
        size: 6000000000,
        available: true,
        lastModified: new Date().toISOString()
      }
    ];

    return mockModels.filter(model => model.type === type);
  }

  /**
   * Check if all required dependencies are available
   */
  async areAllDependenciesAvailable(dependencies: WorkflowDependency[]): Promise<boolean> {
    const result = await this.checkAvailability(dependencies);
    return result.missing.length === 0;
  }

  /**
   * Get missing dependencies that need to be downloaded
   */
  async getMissingDependencies(dependencies: WorkflowDependency[]): Promise<ModelInfo[]> {
    const result = await this.checkAvailability(dependencies);
    return result.missing;
  }
}
