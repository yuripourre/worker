/**
 * Internet Tool Availability Checker
 *
 * Checks if the worker can connect to addresses outside the local network
 */

import { CapabilityChecker, CapabilityCheckResult } from '../../utils/tool-availability-checker';

const INTERNET_CHECK_TIMEOUT_MS = 5000;
const INTERNET_CHECK_URLS = [
  'https://www.google.com', // Google
  'https://1.1.1.1', // Cloudflare DNS
  'https://cloudflare.com', // Cloudflare website
];

export class InternetChecker implements CapabilityChecker {
  name = 'Internet';

  async check(): Promise<CapabilityCheckResult> {
    // Try to connect to a well-known public endpoint
    for (const url of INTERNET_CHECK_URLS) {
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'JobServer-Worker/1.0',
          },
          // Add timeout to prevent hanging
          signal: AbortSignal.timeout(INTERNET_CHECK_TIMEOUT_MS),
        });

        // If we get any response (even an error), we have internet connectivity
        return {
          name: this.name,
          available: true,
          details: `Worker can connect to external addresses. Tested against ${url}`,
        };
      } catch (error) {
        // Continue to next URL if this one fails
        if (error instanceof Error && error.name === 'AbortError') {
          // Timeout - try next URL
          continue;
        }
        // Other errors - try next URL
        continue;
      }
    }

    // If all URLs failed, no internet connectivity
    return {
      name: this.name,
      available: false,
      error: `Cannot connect to external addresses. Checked ${INTERNET_CHECK_URLS.length} endpoints.`,
    };
  }
}

/**
 * Create and register Internet checker with the tool availability checker
 */
export function registerInternetChecker(): void {
  const { capabilityAvailabilityChecker } = require('../../utils/tool-availability-checker');
  const checker = new InternetChecker();
  capabilityAvailabilityChecker.registerChecker(checker);
}

