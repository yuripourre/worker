/**
 * Ollama Tool Availability Checker
 * 
 * Checks if Ollama is available and running on the system
 */

import { CapabilityChecker, CapabilityCheckResult } from '../../utils/tool-availability-checker';

export class OllamaChecker implements CapabilityChecker {
  name = 'ollama';
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }

  async check(): Promise<CapabilityCheckResult> {
    try {
      // Check if Ollama API is responding
      const response = await fetch(`${this.baseUrl}/api/tags`, {
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
          error: `Ollama API returned status ${response.status}: ${response.statusText}`
        };
      }

      const data = await response.json();
      const models = data.models || [];
      
      return {
        name: this.name,
        available: true,
        version: data.version || 'unknown',
        details: `Ollama is running with ${models.length} models available. Base URL: ${this.baseUrl}`
      };

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          name: this.name,
          available: false,
          error: `Ollama check timed out after 5 seconds. Is Ollama running on ${this.baseUrl}?`
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
 * Create and register Ollama checker with the tool availability checker
 */
export function registerOllamaChecker(baseUrl?: string): void {
  const { capabilityAvailabilityChecker } = require('../../utils/tool-availability-checker');
  const checker = new OllamaChecker(baseUrl);
  capabilityAvailabilityChecker.registerChecker(checker);
}
