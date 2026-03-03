import { ExecutableJob, ExecutableJobResult } from '../../types';
import { CategoryExecutor } from './category-executor';
import { isFileRequestJobContext } from '../../../shared';
import { FileTransferService } from '../../../services/file-transfer/file-transfer-service';
import { LocalServer } from '../../../local-server';
import { existsSync } from 'fs';

/**
 * File Request Category Executor
 * Handles file generation, request jobs, and inter-worker file transfers
 */
export class FileRequestCategoryExecutor implements CategoryExecutor {
  private fileTransferService?: FileTransferService;

  constructor(
    private baseUrl?: string,
    private deviceId?: string,
    private workerId?: string,
    private existingLocalServer?: LocalServer
  ) {
    // Initialize file transfer service (defer to avoid blocking constructor)
    this.initializeFileTransferService();
  }

  private async initializeFileTransferService(): Promise<void> {
    try {
      // If an existing LocalServer is provided, use it
      if (this.existingLocalServer) {
        console.log('📁 Using existing LocalServer from Worker for FileTransferService');
        this.fileTransferService = new FileTransferService({
          serverPort: 51115,
          uploadDir: './uploads',
          clientTimeout: 30000,
          existingServer: this.existingLocalServer
        } as any);

        // Mark as started since we're using existing server
        await this.fileTransferService.start();
        console.log('📁 File transfer service initialized using existing LocalServer');
        return;
      }

      // Otherwise, try to create a new server (but expect it might already be running)
      this.fileTransferService = new FileTransferService({
        serverPort: 51115,
        uploadDir: './uploads',
        clientTimeout: 30000
      });

      try {
        await this.fileTransferService.start();
        console.log('📁 File transfer service initialized on port 51115');
      } catch (error: any) {
        if (error?.code === 'EADDRINUSE' || error?.message?.includes('EADDRINUSE')) {
          console.log('📁 Port 51115 already in use - server is likely already running from Worker');
          // The server is already running, so we can still use the service
          // But since we couldn't start it, the service won't work properly
          // This is a fallback case
        } else {
          console.error('❌ Failed to start file transfer service:', error);
          throw error;
        }
      }
    } catch (error) {
      console.error('❌ Failed to initialize file transfer service:', error);
      // Don't throw - allow the executor to continue without file transfer
    }
  }

  async executePlan(job: ExecutableJob): Promise<ExecutableJobResult> {
    // Dummy plan execution - just mark as complete
    return {
      status: 'success',
      answer: 'File request plan completed'
    };
  }

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isFileRequestJobContext(job.context)) {
      throw new Error('File request context is required for file request jobs');
    }
    const fileContext = job.context;

    // Check if this is a file transfer request (requester is an IP address)
    const isFileTransfer = this.isIpAddress(fileContext.requester);

    if (isFileTransfer) {
      return this.executeFileTransfer(fileContext, job);
    } else {
      // For non-IP requesters, fail the job
      return {
        status: 'failed',
        answer: `File request failed: Requester must be an IP address for file transfer. Got: ${fileContext.requester}`

      };
    }
  }

  async executeReview(job: ExecutableJob, childAnswers: Map<string, string>): Promise<ExecutableJobResult> {
    // Dummy review execution - just mark as complete
    return {
      status: 'success',
      answer: 'File request review completed'
    };
  }
  private async executeFileTransfer(fileContext: any, job: ExecutableJob): Promise<ExecutableJobResult> {
    try {
      if (!this.fileTransferService) {
        throw new Error('File transfer service not initialized');
      }

      // Parse IP and port from requester (format: "192.168.0.23:51115" or just "192.168.0.23")
      const [targetIp, targetPortStr] = fileContext.requester.split(':');
      const targetPort = targetPortStr ? parseInt(targetPortStr) : 51115;

      // Test connection first
      const isConnected = await this.fileTransferService.testConnection(targetIp, targetPort);
      if (!isConnected) {
        throw new Error(`Cannot connect to worker at ${targetIp}:${targetPort}`);
      }

      // Generate or prepare the file
      const filePath = await this.prepareFileForTransfer(fileContext);

      // Send the file (no retries - if it fails, mark as failed)
      const result = await this.fileTransferService.sendFile(
        targetIp,
        targetPort,
        filePath,
        fileContext.fileName
      );

      return {
        status: 'success',
        answer: `File transferred successfully to ${fileContext.requester}

Transfer Details:
- Target: ${targetIp}:${targetPort}
- File: ${result.fileName}
- Size: ${result.fileSize} bytes
- Status: Success`

      };
    } catch (error) {
      // If transfer fails, mark as failed so another worker can try
      return {
        status: 'failed',
        answer: `File transfer failed: ${error instanceof Error ? error.message : 'Unknown error'}`

      };
    }
  }

  private async prepareFileForTransfer(fileContext: any): Promise<string> {
    // Check if fileName is a path to an existing file
    if (fileContext.fileName && existsSync(fileContext.fileName)) {
      // Use the existing file
      return fileContext.fileName;
    }

    // If no existing file, fail the job
    throw new Error(`File not found: ${fileContext.fileName || 'No file specified'}`);
  }
  private isIpAddress(requester: string): boolean {
    // Simple check for IP address format (basic validation)
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;
    return ipRegex.test(requester);
  }

  /**
   * Get file transfer service status
   */
  getFileTransferStatus(): any {
    return this.fileTransferService?.getStatus();
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.fileTransferService) {
      await this.fileTransferService.stop();
    }
  }
}
