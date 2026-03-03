import { LocalServer, LocalServerConfig } from '../../local-server';
import { FileTransferClient, FileTransferClientConfig, FileTransferRequest } from './file-transfer-client';
import { existsSync, mkdirSync } from 'fs';

export interface FileTransferServiceConfig {
  serverPort: number;
  uploadDir: string;
  authToken?: string;
  clientTimeout: number;
}

export class FileTransferService {
  private server?: LocalServer;
  private client: FileTransferClient;
  private config: FileTransferServiceConfig;
  private isStarted: boolean = false;
  private useExistingServer: boolean = false;

  constructor(config: Partial<FileTransferServiceConfig & { existingServer?: LocalServer }> = {}) {
    this.config = {
      serverPort: config.serverPort || 51115,
      uploadDir: config.uploadDir || './uploads',
      authToken: config.authToken,
      clientTimeout: config.clientTimeout || 30000
    };

    // If an existing server is provided, use it instead of creating a new one
    if ((config as any).existingServer) {
      this.server = (config as any).existingServer;
      this.useExistingServer = true;
      console.log('📁 FileTransferService: Using existing LocalServer instance');
    } else {
      // Ensure upload directory exists
      if (!existsSync(this.config.uploadDir)) {
        mkdirSync(this.config.uploadDir, { recursive: true });
      }

      // Initialize server
      const serverConfig: LocalServerConfig = {
        port: this.config.serverPort,
        uploadDir: this.config.uploadDir,
        authToken: this.config.authToken
      };

      this.server = new LocalServer(serverConfig);
    }

    // Initialize client
    const clientConfig: FileTransferClientConfig = {
      timeout: this.config.clientTimeout
    };

    this.client = new FileTransferClient(clientConfig);
  }

  /**
   * Start the file transfer service (starts the server)
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      console.log('📁 File transfer service already started');
      return;
    }

    // If using an existing server, just mark as started (server is already running)
    if (this.useExistingServer && this.server?.isServerRunning()) {
      this.isStarted = true;
      console.log(`📁 File transfer service using existing server on port ${this.config.serverPort}`);
      return;
    }

    if (!this.server) {
      throw new Error('Server not initialized');
    }

    try {
      await this.server.start();
      this.isStarted = true;
      console.log(`📁 File transfer service started on port ${this.config.serverPort}`);
    } catch (error) {
      console.error('❌ Failed to start file transfer service:', error);
      throw error;
    }
  }

  /**
   * Stop the file transfer service
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    // Don't stop the server if we're using an existing one (it's managed elsewhere)
    if (this.useExistingServer) {
      this.isStarted = false;
      console.log('📁 File transfer service stopped (using existing server - not stopping it)');
      return;
    }

    if (!this.server) {
      return;
    }

    try {
      await this.server.stop();
      this.isStarted = false;
      console.log('📁 File transfer service stopped');
    } catch (error) {
      console.error('❌ Failed to stop file transfer service:', error);
      throw error;
    }
  }

  /**
   * Send a file to another worker
   */
  async sendFile(targetIp: string, targetPort: number, filePath: string, fileName?: string): Promise<any> {
    const request: FileTransferRequest = {
      targetIp,
      targetPort,
      filePath,
      fileName,
      authToken: this.config.authToken
    };

    return await this.client.sendFile(request);
  }

  /**
   * Test connection to another worker
   */
  async testConnection(targetIp: string, targetPort: number): Promise<boolean> {
    return await this.client.testConnection(targetIp, targetPort);
  }

  /**
   * Get the server port
   */
  getServerPort(): number {
    return this.config.serverPort;
  }

  /**
   * Get the upload directory
   */
  getUploadDir(): string {
    return this.config.uploadDir;
  }

  /**
   * Check if service is running
   */
  isRunning(): boolean {
    if (!this.server) {
      return false;
    }
    return this.isStarted && this.server.isServerRunning();
  }

  /**
   * Get service status
   */
  getStatus(): { running: boolean; port: number; uploadDir: string } {
    return {
      running: this.isRunning(),
      port: this.config.serverPort,
      uploadDir: this.config.uploadDir
    };
  }
}
