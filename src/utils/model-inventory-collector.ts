import { ModelInventory } from '../shared';

export interface OllamaModelInfo {
  name: string;
  size: number;
  modified_at?: string;
  digest?: string;
}

export interface ComfyUIModelCategory {
  name: string;
  path: string;
  fileCount?: number;
  files?: Array<{ name: string; size: number; modified?: string; path: string }>;
}
import { OllamaClient } from '../services/ollama-client';
import { listComfyUIModels } from './comfyui-models-lister';

/**
 * Collect model inventory from Ollama and ComfyUI
 */
export async function collectModelInventory(
  ollamaBaseUrl?: string,
  comfyuiPath?: string
): Promise<ModelInventory | undefined> {
  try {
    const inventory: ModelInventory = {
      lastUpdated: new Date().toISOString()
    };

    // Try to collect Ollama models
    try {
      const ollamaModels = await collectOllamaModels(ollamaBaseUrl);
      if (ollamaModels && ollamaModels.length > 0) {
        inventory.ollamaModels = ollamaModels;
      }
    } catch (error) {
      console.debug('Could not collect Ollama models:', error instanceof Error ? error.message : 'Unknown error');
    }

    // Try to collect ComfyUI models
    try {
      const comfyuiModels = await collectComfyUIModels(comfyuiPath);
      if (comfyuiModels && comfyuiModels.length > 0) {
        inventory.comfyuiModels = comfyuiModels;
      }
    } catch (error) {
      console.debug('Could not collect ComfyUI models:', error instanceof Error ? error.message : 'Unknown error');
    }

    // Return inventory only if we collected at least some data
    if (inventory.ollamaModels || inventory.comfyuiModels) {
      return inventory;
    }

    return undefined;
  } catch (error) {
    console.error('Error collecting model inventory:', error);
    return undefined;
  }
}

/**
 * Collect Ollama models
 */
async function collectOllamaModels(baseUrl?: string): Promise<OllamaModelInfo[] | undefined> {
  try {
    const ollamaClient = new OllamaClient({
      baseUrl: baseUrl || 'http://localhost:11434'
    });

    const status = await ollamaClient.checkStatus();
    if (!status.isRunning) {
      return undefined;
    }

    const models = await ollamaClient.listModels();
    return models.map(m => ({
      name: m.name,
      size: m.size,
      modified_at: m.modified_at,
      digest: m.digest
    }));
  } catch (error) {
    console.debug('Ollama not available:', error instanceof Error ? error.message : 'Unknown error');
    return undefined;
  }
}

/**
 * Collect ComfyUI models
 */
async function collectComfyUIModels(comfyuiPath?: string): Promise<ComfyUIModelCategory[] | undefined> {
  try {
    const data = await listComfyUIModels(comfyuiPath);
    if (!data.categories || data.categories.length === 0) {
      return undefined;
    }

    return data.categories.map((cat: any) => ({
      name: cat.name,
      path: cat.path,
      fileCount: cat.files?.length ?? 0,
      files: cat.files?.map((f: any) => ({
        name: f.name,
        size: f.size,
        modified: f.modified instanceof Date ? f.modified.toISOString() : f.modified,
        path: f.path,
      })),
    }));
  } catch (error) {
    console.debug('ComfyUI not available:', error instanceof Error ? error.message : 'Unknown error');
    return undefined;
  }
}

