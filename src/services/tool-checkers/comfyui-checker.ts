/**
 * ComfyUI Tool Availability Checker
 * 
 * Checks if ComfyUI is available and running on the system
 */

import { CapabilityChecker, CapabilityCheckResult } from '../../utils/tool-availability-checker';

export class ComfyUIChecker implements CapabilityChecker {
  name = 'comfyui';
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8188') {
    this.baseUrl = baseUrl;
  }

  async check(): Promise<CapabilityCheckResult> {
    try {
      // Check if ComfyUI API is responding
      const response = await fetch(`${this.baseUrl}/system_stats`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        return {
          name: this.name,
          available: false,
          error: `ComfyUI API returned status ${response.status}: ${response.statusText}`
        };
      }

      const data = await response.json();
      
      return {
        name: this.name,
        available: true,
        version: data.version || 'unknown',
        details: `ComfyUI is running. Base URL: ${this.baseUrl}. System: ${data.system?.platform || 'unknown'}`
      };

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          name: this.name,
          available: false,
          error: `ComfyUI check timed out after 5 seconds. Is ComfyUI running on ${this.baseUrl}?`
        };
      }

      return {
        name: this.name,
        available: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

/**
 * Create and register ComfyUI checker with the tool availability checker
 */
export function registerComfyUIChecker(baseUrl?: string): void {
  const { capabilityAvailabilityChecker } = require('../../utils/tool-availability-checker');
  const checker = new ComfyUIChecker(baseUrl);
  capabilityAvailabilityChecker.registerChecker(checker);
}
