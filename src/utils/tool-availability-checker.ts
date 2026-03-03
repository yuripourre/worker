/**
 * Capability Availability Checker Service
 *
 * This service provides an easy way to register and check the availability of various capabilities
 * that the worker can use. It's designed to be extensible and easy to add new capability checks.
 */

export interface CapabilityCheckResult {
  name: string;
  available: boolean;
  version?: string;
  details?: string;
  error?: string;
}

export interface CapabilityChecker {
  name: string;
  check: () => Promise<CapabilityCheckResult>;
}

export class CapabilityAvailabilityChecker {
  private checkers: Map<string, CapabilityChecker> = new Map();

  /**
   * Register a new capability checker
   */
  registerChecker(checker: CapabilityChecker): void {
    this.checkers.set(checker.name, checker);
  }

  /**
   * Check availability of a specific capability
   */
  async checkCapability(capabilityName: string): Promise<CapabilityCheckResult> {
    const checker = this.checkers.get(capabilityName);
    if (!checker) {
      return {
        name: capabilityName,
        available: false,
        error: `No checker registered for capability: ${capabilityName}`
      };
    }

    try {
      return await checker.check();
    } catch (error) {
      return {
        name: capabilityName,
        available: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Check availability of all registered capabilities
   */
  async checkAllCapabilities(): Promise<CapabilityCheckResult[]> {
    const results: CapabilityCheckResult[] = [];

    for (const [capabilityName, checker] of this.checkers) {
      const result = await this.checkCapability(capabilityName);
      results.push(result);
    }

    return results;
  }

  /**
   * Get list of available capabilities (only those that are available)
   */
  async getAvailableCapabilities(): Promise<CapabilityCheckResult[]> {
    const allResults = await this.checkAllCapabilities();
    return allResults.filter(result => result.available);
  }

  /**
   * Get list of capability names that are available
   */
  async getAvailableCapabilityNames(): Promise<string[]> {
    const availableCapabilities = await this.getAvailableCapabilities();
    return availableCapabilities.map(capability => capability.name);
  }

  /**
   * Get detailed status of all capabilities
   */
  async getCapabilityStatus(): Promise<{ available: CapabilityCheckResult[]; unavailable: CapabilityCheckResult[] }> {
    const allResults = await this.checkAllCapabilities();
    const available = allResults.filter(result => result.available);
    const unavailable = allResults.filter(result => !result.available);

    return { available, unavailable };
  }
}

// Create a singleton instance
export const capabilityAvailabilityChecker = new CapabilityAvailabilityChecker();












