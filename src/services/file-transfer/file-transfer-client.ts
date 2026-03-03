import { statSync, existsSync } from 'fs';
import { basename } from 'path';

export interface FileTransferClientConfig {
  timeout: number; // in milliseconds
}

export interface FileTransferRequest {
  targetIp: string;
  targetPort: number;
  filePath: string;
  fileName?: string;
  authToken?: string;
  targetPath?: string; // Destination folder path on target worker
}

export interface FileTransferResponse {
  success: boolean;
  fileName: string;
  filePath: string;
  fileSize: number;
  error?: string;
}

export class FileTransferClient {
  private config: FileTransferClientConfig;

  constructor(config: Partial<FileTransferClientConfig> = {}) {
    this.config = {
      timeout: config.timeout || 30000 // 30 seconds
    };
  }

  /**
   * Normalize IP address - extract IPv4 from IPv4-mapped IPv6 addresses
   * Handles addresses like "::ffff:192.168.50.230" -> "192.168.50.230"
   */
  private normalizeIpAddress(ip: string): string {
    // Check if it's an IPv4-mapped IPv6 address (::ffff:IPv4)
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7); // Extract IPv4 part after "::ffff:"
    }
    // Check if it's an IPv4-mapped IPv6 address with brackets [::ffff:IPv4]
    if (ip.startsWith('[::ffff:') && ip.endsWith(']')) {
      return ip.substring(8, ip.length - 1); // Extract IPv4 part
    }
    // Return as-is for regular IPv4 or IPv6 addresses
    return ip;
  }

  /**
   * Send a file to another worker
   */
  async sendFile(request: FileTransferRequest): Promise<FileTransferResponse> {
    // Validate file exists
    if (!existsSync(request.filePath)) {
      throw new Error(`File not found: ${request.filePath}`);
    }

    const stats = statSync(request.filePath);
    const fileName = request.fileName || basename(request.filePath);

    console.log(`📤 Sending file to ${request.targetIp}:${request.targetPort}`);
    console.log(`📁 File: ${fileName} (${stats.size} bytes)`);

    try {
      const result = await this.uploadFile(request, fileName, stats.size);
      console.log(`✅ File sent successfully: ${result.fileName}`);
      return result;
    } catch (error) {
      const lastError = error instanceof Error ? error : new Error('Unknown error');
      console.error(`❌ Upload failed: ${lastError.message}`);
      throw lastError;
    }
  }

  /**
   * Upload file to target worker
   */
  private async uploadFile(
    request: FileTransferRequest,
    fileName: string,
    fileSize: number
  ): Promise<FileTransferResponse> {
    // Normalize IP address to handle IPv4-mapped IPv6 addresses
    const normalizedIp = this.normalizeIpAddress(request.targetIp);
    // Build upload URL with optional target path
    const url = new URL(`http://${normalizedIp}:${request.targetPort}/upload`);
    if (request.targetPath) {
      url.searchParams.set('path', request.targetPath);
    }

    // Use Bun's file API directly - it supports streaming for large files
    const file = Bun.file(request.filePath);
    if (!await file.exists()) {
      throw new Error(`File not found: ${request.filePath}`);
    }

    // Create form data - Bun.file() can be used directly and will stream
    // This avoids loading the entire file into memory
    const formData = new FormData();
    formData.append('file', file, fileName);

    // Prepare headers
    const headers: Record<string, string> = {};

    if (request.authToken) {
      headers['Authorization'] = `Bearer ${request.authToken}`;
    }

    // Calculate dynamic timeout based on file size
    // Base timeout: 30 seconds
    // Additional time: assume minimum 10 MB/s transfer rate (conservative estimate)
    // Add extra buffer (2x) for network variability
    const MIN_TRANSFER_RATE_BYTES_PER_SEC = 10 * 1024 * 1024; // 10 MB/s
    const BUFFER_MULTIPLIER = 2;
    const baseTimeout = this.config.timeout;
    const transferTime = (fileSize / MIN_TRANSFER_RATE_BYTES_PER_SEC) * 1000; // Convert to ms
    const dynamicTimeout = baseTimeout + (transferTime * BUFFER_MULTIPLIER);

    // Cap timeout at 1 hour for extremely large files
    const MAX_TIMEOUT = 60 * 60 * 1000; // 1 hour
    const timeout = Math.min(dynamicTimeout, MAX_TIMEOUT);

    console.log(`⏱️  Upload timeout set to ${Math.round(timeout / 1000)}s for ${Math.round(fileSize / (1024 * 1024))} MB file`);

    // Make request with dynamic timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await globalThis.fetch(url.toString(), {
        method: 'POST',
        body: formData,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json() as FileTransferResponse;

      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }

      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Upload timeout after ${Math.round(timeout / 1000)}s`);
      }

      throw error;
    }
  }

  /**
   * Get content type based on file extension
   */
  private getContentType(fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase();

    const contentTypes: Record<string, string> = {
      'txt': 'text/plain',
      'json': 'application/json',
      'xml': 'application/xml',
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'pdf': 'application/pdf',
      'zip': 'application/zip',
      'tar': 'application/x-tar',
      'gz': 'application/gzip',
      'mp4': 'video/mp4',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav'
    };

    return contentTypes[extension || ''] || 'application/octet-stream';
  }


  /**
   * Test connection to target worker
   */
  async testConnection(targetIp: string, targetPort: number): Promise<boolean> {
    try {
      // Normalize IP address to handle IPv4-mapped IPv6 addresses
      const normalizedIp = this.normalizeIpAddress(targetIp);
      const url = `http://${normalizedIp}:${targetPort}/health`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}
