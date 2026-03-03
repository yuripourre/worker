import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * List all ComfyUI models organized by category
 */
export async function listComfyUIModels(comfyuiPath?: string): Promise<{
  categories: Array<{
    name: string;
    path: string;
    files: Array<{ name: string; size: number; modified: Date; path: string }>;
  }>;
}> {
  // If comfyuiPath is provided, models are in the 'models' subdirectory
  const comfyuiBasePath = comfyuiPath
    ? join(comfyuiPath, 'models')
    : process.env.COMFYUI_MODELS_PATH;

  if (!comfyuiBasePath) {
    // If no path is configured, return empty categories
    return { categories: [] };
  }

  const categories = [
    { name: 'Checkpoints', path: join(comfyuiBasePath, 'checkpoints') },
    { name: 'LoRAs', path: join(comfyuiBasePath, 'loras') },
    { name: 'VAE', path: join(comfyuiBasePath, 'vae') },
    { name: 'Upscale Models', path: join(comfyuiBasePath, 'upscale_models') },
    { name: 'ControlNet', path: join(comfyuiBasePath, 'controlnet') },
    { name: 'Embeddings', path: join(comfyuiBasePath, 'embeddings') },
    { name: 'Clip', path: join(comfyuiBasePath, 'clip') },
    { name: 'UNET', path: join(comfyuiBasePath, 'unet') },
    { name: 'Style Models', path: join(comfyuiBasePath, 'style_models') },
  ];

  const result = [];

  for (const category of categories) {
    if (existsSync(category.path)) {
      try {
        const files = readdirSync(category.path, { withFileTypes: true })
          .filter(dirent => dirent.isFile())
          .map(dirent => {
            const filePath = join(category.path, dirent.name);
            const stats = statSync(filePath);
            return {
              name: dirent.name,
              size: stats.size,
              modified: stats.mtime,
              path: filePath
            };
          });

        result.push({
          name: category.name,
          path: category.path,
          files
        });
      } catch (error) {
        console.warn(`Failed to read directory ${category.path}:`, error);
        result.push({
          name: category.name,
          path: category.path,
          files: []
        });
      }
    } else {
      result.push({
        name: category.name,
        path: category.path,
        files: []
      });
    }
  }

  return { categories: result };
}

