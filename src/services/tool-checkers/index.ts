/**
 * Capability Checkers Index
 *
 * Central place to register all capability availability checkers
 */

import { registerOllamaChecker } from './ollama-checker';
import { registerComfyUIChecker } from './comfyui-checker';
import { registerInternetChecker } from './internet-checker';

/**
 * Register all available capability checkers
 *
 * @param ollamaBaseUrl - Optional Ollama base URL (default: http://localhost:11434)
 * @param comfyuiBaseUrl - Optional ComfyUI base URL (default: http://localhost:8188)
 */
export function registerAllCapabilityCheckers(
  ollamaBaseUrl?: string,
  comfyuiBaseUrl?: string
): void {
  // Register Ollama checker
  registerOllamaChecker(ollamaBaseUrl);

  // Register ComfyUI checker
  registerComfyUIChecker(comfyuiBaseUrl);

  // Register Internet checker
  registerInternetChecker();

  // Add more capability checkers here as needed
  // registerCustomCapabilityChecker();
}

/**
 * Register only specific capability checkers
 */
export function registerCapabilityCheckers(options: {
  ollama?: { baseUrl?: string };
  comfyui?: { baseUrl?: string };
}): void {
  if (options.ollama) {
    registerOllamaChecker(options.ollama.baseUrl);
  }

  if (options.comfyui) {
    registerComfyUIChecker(options.comfyui.baseUrl);
  }
}

// Export individual checkers for advanced usage
export { OllamaChecker } from './ollama-checker';
export { ComfyUIChecker } from './comfyui-checker';
export { InternetChecker } from './internet-checker';
export { registerOllamaChecker } from './ollama-checker';
export { registerComfyUIChecker } from './comfyui-checker';
export { registerInternetChecker } from './internet-checker';
