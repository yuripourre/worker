import { createWriteStream, readdirSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, basename, resolve, dirname } from 'path';
import { pipeline } from 'stream';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { FileTransferClient } from './services/file-transfer/file-transfer-client';
import { TerminalSessionManager, TerminalSession } from './services/terminal/terminal-session';

const pipelineAsync = promisify(pipeline);

export interface LocalServerConfig {
  port: number;
  uploadDir: string;
  authToken?: string;
  comfyuiPath?: string;
  comfyuiBaseUrl?: string;
  ollamaBaseUrl?: string;
}

export interface FileTransferResult {
  success: boolean;
  fileName: string;
  filePath: string;
  fileSize: number;
  error?: string;
}

export interface FileTransferToWorkerRequest {
  filePath: string;
  targetIp: string;
  targetPort?: number;
  fileName?: string;
  targetPath?: string; // Destination folder path on target worker
}

interface WebSocketConnection {
  ws: any;
  session: TerminalSession;
}

export class LocalServer {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private config: LocalServerConfig;
  private isRunning: boolean = false;
  private fileTransferClient: FileTransferClient;
  private terminalSessionManager: TerminalSessionManager;
  private wsConnections: Map<string, WebSocketConnection> = new Map();
  private configUpdateCallback?: (config: { comfyuiPath?: string; comfyuiBaseUrl?: string; ollamaBaseUrl?: string }) => void;

  constructor(config: LocalServerConfig) {
    this.config = config;

    // Ensure upload directory exists
    if (!existsSync(this.config.uploadDir)) {
      mkdirSync(this.config.uploadDir, { recursive: true });
    }

    // Initialize file transfer client for transferring files to other workers
    this.fileTransferClient = new FileTransferClient({
      timeout: 60000 // 60 seconds default timeout
    });

    // Initialize terminal session manager for WebSocket sessions
    this.terminalSessionManager = new TerminalSessionManager();
  }

  /**
   * Start the local server using Bun.serve
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = Bun.serve({
          port: this.config.port,
          fetch: (req) => this.handleRequest(req),
          // Allow very large file uploads (up to 10GB)
          // This is needed for large model files and checkpoints
          maxRequestBodySize: 10 * 1024 * 1024 * 1024, // 10 GB
          websocket: {
            message: (ws, message) => {
              this.handleWebSocketMessage(ws, message);
            },
            open: (ws) => {
              this.handleWebSocketOpen(ws);
            },
            close: (ws) => {
              this.handleWebSocketClose(ws);
            },
          },
        });

        this.isRunning = true;
        console.log(`📁 Local server started on port ${this.config.port}`);
        resolve();
      } catch (error) {
        console.error('❌ Local server error:', error);
        reject(error);
      }
    });
  }

  /**
   * Stop the local server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server && this.isRunning) {
        // Close all WebSocket connections
        for (const conn of this.wsConnections.values()) {
          conn.session.stop();
          try {
            conn.ws.close();
          } catch (e) {
            // Ignore errors during cleanup
          }
        }
        this.wsConnections.clear();
        this.terminalSessionManager.cleanup();

        this.server.stop();
        this.isRunning = false;
        console.log('📁 Local server stopped');
        resolve();
      } else {
        resolve();
      }
    });
  }

  /**
   * Check if server is deregistering
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get server port
   */
  getPort(): number {
    return this.config.port;
  }

  /**
   * Set callback for configuration updates
   */
  setConfigUpdateCallback(callback: (config: { comfyuiPath?: string; comfyuiBaseUrl?: string; ollamaBaseUrl?: string }) => void): void {
    this.configUpdateCallback = callback;
  }

  /**
   * Update ComfyUI path
   */
  updateComfyUIPath(path: string): void {
    this.config.comfyuiPath = path;
    if (this.configUpdateCallback) {
      this.configUpdateCallback({ comfyuiPath: path });
    }
  }

  /**
   * Update ComfyUI base URL
   */
  updateComfyUIBaseUrl(url: string): void {
    this.config.comfyuiBaseUrl = url;
    if (this.configUpdateCallback) {
      this.configUpdateCallback({ comfyuiBaseUrl: url });
    }
  }

  /**
   * Update Ollama base URL
   */
  updateOllamaBaseUrl(url: string): void {
    this.config.ollamaBaseUrl = url;
    if (this.configUpdateCallback) {
      this.configUpdateCallback({ ollamaBaseUrl: url });
    }
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(req: Request): Promise<Response | undefined> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Handle WebSocket upgrade requests
    // Check if this is a WebSocket upgrade request
    const upgradeHeader = req.headers.get('upgrade');

    const connectionHeader = req.headers.get('connection');

    // Check for WebSocket upgrade (must have both upgrade and connection headers)
    if (upgradeHeader?.toLowerCase() === 'websocket' &&
        connectionHeader?.toLowerCase().includes('upgrade')) {
      // Handle terminal WebSocket
      if (pathname === '/terminal/ws') {
        console.log('🔌 WebSocket upgrade detected in fetch handler');
        console.log(`Request URL: ${req.url}`);
        console.log(`Pathname: ${pathname}`);

        const upgradeResult = this.handleWebSocketUpgrade(req);

        // If upgrade returns undefined, upgrade succeeded and Bun will handle it
        // If upgrade returns a Response, upgrade failed - return the error
        if (upgradeResult !== undefined) {
          console.log('❌ Upgrade failed, returning error response');
          return upgradeResult;
        }

        console.log('✅ Upgrade successful - Bun will handle WebSocket connection internally');
        // Return undefined to let Bun handle the WebSocket upgrade
        // Bun's fetch handler can return undefined when upgrade() succeeds
        return undefined;
      }

      // Handle file operations WebSocket (for future use)
      console.log(`🔌 WebSocket upgrade for unsupported path: ${pathname}`);
      return new Response('WebSocket endpoint not found', { status: 404 });
    }

    // Set CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    // Handle health check
    if (req.method === 'GET' && pathname === '/health') {
      console.log(`🏥 Health check requested - Server running: ${this.isRunning}`);
      return Response.json({
        status: 'ok',
        service: 'local-server',
        port: this.config.port,
        uploadDir: this.config.uploadDir,
        running: this.isRunning
      }, { headers: corsHeaders });
    }

    // Handle file upload
    if (req.method === 'POST' && pathname === '/upload') {
      // Log upload start for large files
      const contentLength = req.headers.get('content-length');
      const sizeMB = contentLength ? parseInt(contentLength) / (1024 * 1024) : 0;
      if (sizeMB > 100) {
        console.log(`📤 Large file upload started: ${Math.round(sizeMB)} MB`);
      }

      // For very large files (>2GB), warn that this might fail
      if (sizeMB > 2048) {
        console.warn(`⚠️  Very large file upload (>2GB) - this may fail due to memory constraints`);
      }

      // Wrap in try-catch to ensure we always send a response with CORS headers
      try {
        const result = await this.handleFileUpload(req);
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        console.error('❌ File upload error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Provide more helpful error messages
        let userMessage = errorMessage;
        if (errorMessage.includes('memory') || errorMessage.includes('too large') || sizeMB > 1000) {
          userMessage = `File too large (${Math.round(sizeMB)} MB). For files larger than 1GB, consider using file transfer between workers instead of direct upload.`;
        } else if (errorMessage.includes('timeout') || errorMessage.includes('aborted')) {
          userMessage = `Upload failed: ${errorMessage}. The file may be too large or the network connection may be too slow.`;
        }

        const errorResult: FileTransferResult = {
          success: false,
          fileName: '',
          filePath: '',
          fileSize: 0,
          error: userMessage
        };
        // Always return CORS headers even on error - this is critical for CORS errors
        return Response.json(errorResult, { status: 500, headers: corsHeaders });
      }
    }

    // Handle list files
    if (req.method === 'GET' && pathname === '/files') {
      try {
        const result = await this.handleListFiles(url.searchParams.get('path') || undefined);
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500, headers: corsHeaders });
      }
    }

    // Handle download file (legacy: /files/:name)
    if (req.method === 'GET' && pathname.startsWith('/files/')) {
      const fileName = decodeURIComponent(pathname.substring('/files/'.length));
      try {
        return await this.handleDownloadFileLegacy(fileName, corsHeaders);
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : 'File not found'
        }, { status: 404, headers: corsHeaders });
      }
    }

    // Handle download file with explicit path: /download?path=...
    if (req.method === 'GET' && pathname === '/download') {
      try {
        const requestedPath = url.searchParams.get('path');
        if (!requestedPath) {
          return Response.json({ error: 'Missing path parameter' }, { status: 400, headers: corsHeaders });
        }
        return await this.handleDownloadFile(requestedPath, corsHeaders);
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : 'File not found'
        }, { status: 404, headers: corsHeaders });
      }
    }

    // Handle transfer file to another worker
    if (req.method === 'POST' && pathname === '/files/transfer') {
      try {
        const result = await this.handleTransferFile(req);
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        return Response.json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500, headers: corsHeaders });
      }
    }


    // Handle get worker configuration
    if (req.method === 'GET' && pathname === '/config') {
      try {
        return Response.json({
          comfyuiPath: this.config.comfyuiPath,
          comfyuiBaseUrl: this.config.comfyuiBaseUrl,
          ollamaBaseUrl: this.config.ollamaBaseUrl
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500, headers: corsHeaders });
      }
    }

    // Handle update ComfyUI path
    if (req.method === 'POST' && pathname === '/config/comfyui-path') {
      try {
        const body = await req.json();
        const { path } = body;
        if (!path) {
          return Response.json({ error: 'Path is required' }, { status: 400, headers: corsHeaders });
        }
        this.updateComfyUIPath(path);
        return Response.json({
          success: true,
          message: 'ComfyUI path updated successfully',
          comfyuiPath: path
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500, headers: corsHeaders });
      }
    }

    // Handle update ComfyUI base URL
    if (req.method === 'POST' && pathname === '/config/comfyui-url') {
      try {
        const body = await req.json();
        const { url } = body;
        if (!url) {
          return Response.json({ error: 'URL is required' }, { status: 400, headers: corsHeaders });
        }
        this.updateComfyUIBaseUrl(url);
        return Response.json({
          success: true,
          message: 'ComfyUI base URL updated successfully',
          comfyuiBaseUrl: url
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500, headers: corsHeaders });
      }
    }

    // Handle update Ollama base URL
    if (req.method === 'POST' && pathname === '/config/ollama-url') {
      try {
        const body = await req.json();
        const { url } = body;
        if (!url) {
          return Response.json({ error: 'URL is required' }, { status: 400, headers: corsHeaders });
        }
        this.updateOllamaBaseUrl(url);
        return Response.json({
          success: true,
          message: 'Ollama base URL updated successfully',
          ollamaBaseUrl: url
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500, headers: corsHeaders });
      }
    }

    // Handle create folder
    if (req.method === 'POST' && pathname === '/files/create-folder') {
      try {
        const result = await this.handleCreateFolder(req);
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        return Response.json({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500, headers: corsHeaders });
      }
    }

    // If we reach here, it's an unsupported endpoint
    return Response.json({ error: 'Endpoint not found' }, { status: 404, headers: corsHeaders });
  }

  /**
   * Handle WebSocket upgrade for terminal sessions
   */
  private handleWebSocketUpgrade(req: Request): Response | undefined {
    try {
      const url = new URL(req.url);
      const workingDir = url.searchParams.get('cwd') || undefined;
      const cols = parseInt(url.searchParams.get('cols') || '80', 10);
      const rows = parseInt(url.searchParams.get('rows') || '24', 10);

      // Create a new terminal session with initial dimensions
      const session = this.terminalSessionManager.createSession(workingDir, cols, rows);
      const sessionId = session.getSessionId();
      console.log(`🔌 WebSocket upgrade request - Session ID: ${sessionId.substring(0, 8)}...`);
      console.log(`📏 Initial terminal size: ${cols}x${rows}`);

      // Upgrade to WebSocket with session data
      const upgraded = this.server!.upgrade(req, {
        data: { sessionId },
      });

      if (!upgraded) {
        console.error('❌ WebSocket upgrade returned false - upgrade failed');
        return new Response('WebSocket upgrade failed', { status: 426 });
      }

      console.log(`✅ WebSocket upgrade successful - returning undefined to let Bun handle it`);
      // Return undefined to let Bun handle the upgrade automatically
      // Bun will call the websocket.open handler when connection is established
      return undefined;
    } catch (error) {
      console.error('❌ Error during WebSocket upgrade:', error);
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      return new Response(`Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 });
    }
  }

  /**
   * Handle WebSocket connection open
   */
  private handleWebSocketOpen(ws: any): void {
    const sessionId = ws.data?.sessionId;

    if (!sessionId) {
      console.error('WebSocket opened without session ID');
      ws.close();
      return;
    }

    const session = this.terminalSessionManager.getSession(sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      ws.close();
      return;
    }

    this.wsConnections.set(sessionId, { ws, session });

    session.start(
      (data: string) => {
        try {
          if (ws.readyState === 1) {
            ws.send(data);
          }
        } catch (error) {
          console.error('Error sending output:', error);
        }
      },
      (data: string) => {
        try {
          if (ws.readyState === 1) {
            ws.send(data);
          }
        } catch (error) {
          console.error('Error sending error:', error);
        }
      }
    );
  }

  /**
   * Handle WebSocket messages
   */
  private handleWebSocketMessage(ws: any, message: string | Buffer | ArrayBuffer): void {
    const sessionId = ws.data?.sessionId;
    if (!sessionId) {
      console.warn('⚠️ WebSocket message received without session ID');
      return;
    }

    const connection = this.wsConnections.get(sessionId);
    if (!connection) {
      console.warn(`⚠️ WebSocket message for unknown session: ${sessionId}`);
      return;
    }

    let data: string;
    if (Buffer.isBuffer(message)) {
      data = message.toString('utf8');
    } else if (message instanceof ArrayBuffer) {
      data = Buffer.from(message).toString('utf8');
    } else {
      data = message;
    }

    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
        connection.session.resize(parsed.cols, parsed.rows);
        return;
      } else if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
    } catch {
      // Not JSON, treat as raw terminal input
    }

    connection.session.write(data);
  }

  /**
   * Handle WebSocket connection close
   */
  private handleWebSocketClose(ws: any): void {
    const sessionId = ws.data?.sessionId;
    if (sessionId) {
      const connection = this.wsConnections.get(sessionId);
      if (connection) {
        connection.session.stop();
        this.wsConnections.delete(sessionId);
        this.terminalSessionManager.removeSession(sessionId);
        console.log(`🔌 Terminal session closed: ${sessionId}`);
      }
    }
  }

  /**
   * Handle file upload
   */
  private async handleFileUpload(req: Request): Promise<FileTransferResult> {
    // Check authorization if token is provided
    if (this.config.authToken) {
      const authHeader = req.headers.get('authorization');
      if (!authHeader || authHeader !== `Bearer ${this.config.authToken}`) {
        throw new Error('Unauthorized');
      }
    }

    // Determine destination directory (optional ?path=)
    const url = new URL(req.url);
    const targetDirParam = url.searchParams.get('path');
    const baseDir = targetDirParam && targetDirParam.trim().length > 0
      ? resolve(targetDirParam)
      : resolve(process.cwd());

    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }

    // Check content length for large files
    const contentLength = req.headers.get('content-length');
    const fileSizeMB = contentLength ? parseInt(contentLength) / (1024 * 1024) : 0;
    if (fileSizeMB > 100) {
      console.log(`📤 Starting large file upload: ${Math.round(fileSizeMB)} MB`);
    }

    let formData: FormData;
    let file: File;

    try {
      // Parse form data - Bun's formData() should handle streaming, but for very large files
      // we need to be careful about memory usage
      formData = await req.formData();
      file = formData.get('file') as File;

      if (!file) {
        throw new Error('No file provided');
      }
    } catch (error) {
      // If formData parsing fails (e.g., out of memory), provide a helpful error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('memory') || errorMessage.includes('size') || fileSizeMB > 1000) {
        throw new Error(`File too large to process. Please use file transfer between workers for files larger than 1GB. Original error: ${errorMessage}`);
      }
      throw error;
    }

    // Generate unique filename to avoid conflicts
    const uniqueFileName = this.generateUniqueFileName(file.name);
    const filePath = join(baseDir, uniqueFileName);

    // Write file to disk using Bun's file API - this streams the file
    // Bun.write() handles large files efficiently by streaming
    const startTime = Date.now();
    try {
      await Bun.write(filePath, file);
    } catch (writeError) {
      // If write fails, clean up and provide helpful error
      const errorMessage = writeError instanceof Error ? writeError.message : 'Unknown error';
      console.error(`❌ Failed to write file: ${errorMessage}`);
      throw new Error(`Failed to save file: ${errorMessage}`);
    }
    const writeTime = Date.now() - startTime;

    const stats = statSync(filePath);
    const fileSize = stats.size;

    if (fileSizeMB > 100) {
      const speedMBps = fileSizeMB / (writeTime / 1000);
      console.log(`📁 Large file received: ${uniqueFileName} (${Math.round(fileSizeMB)} MB) in ${Math.round(writeTime / 1000)}s (${Math.round(speedMBps)} MB/s)`);
    } else {
      console.log(`📁 File received: ${uniqueFileName} (${fileSize} bytes)`);
    }

    return {
      success: true,
      fileName: uniqueFileName,
      filePath: filePath,
      fileSize: fileSize
    };
  }

  /**
   * Handle list files request
   */
  private async handleListFiles(requestedPath?: string): Promise<{ currentPath: string; parentPath: string | null; files: Array<{ name: string; size: number; modified: Date; isDirectory: boolean }> }> {
    try {
      const basePath = requestedPath && requestedPath.trim().length > 0
        ? resolve(requestedPath)
        : resolve(process.cwd());

      const entries = readdirSync(basePath, { withFileTypes: true });
      const fileList = entries.map(entry => {
        const fullPath = join(basePath, entry.name);
        const stats = statSync(fullPath);
        return {
          name: entry.name,
          size: entry.isDirectory() ? 0 : stats.size,
          modified: stats.mtime,
          isDirectory: entry.isDirectory()
        };
      });

      const parent = dirname(basePath);
      const parentPath = parent === basePath ? null : parent;

      return { currentPath: basePath, parentPath, files: fileList };
    } catch (error) {
      throw new Error(`Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle download file request
   */
  private async handleDownloadFile(filePathInput: string, corsHeaders: Record<string, string>): Promise<Response> {
    const absPath = resolve(filePathInput);
    if (!existsSync(absPath)) {
      throw new Error('File not found');
    }

    const stats = statSync(absPath);
    const fileBuffer = await Bun.file(absPath).arrayBuffer();

    return new Response(fileBuffer, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${basename(absPath)}"`,
        'Content-Length': stats.size.toString()
      }
    });
  }

  private async handleDownloadFileLegacy(fileName: string, corsHeaders: Record<string, string>): Promise<Response> {
    const safeFileName = basename(fileName);
    const filePath = join(this.config.uploadDir, safeFileName);
    return this.handleDownloadFile(filePath, corsHeaders);
  }

  /**
   * Handle transfer file to another worker
   */
  private async handleTransferFile(req: Request): Promise<{ success: boolean; message: string; error?: string }> {
    // Check authorization if token is provided
    if (this.config.authToken) {
      const authHeader = req.headers.get('authorization');
      if (!authHeader || authHeader !== `Bearer ${this.config.authToken}`) {
        throw new Error('Unauthorized');
      }
    }

    // Parse JSON body - handle potential body size limits
    let request: FileTransferToWorkerRequest;
    try {
      const bodyText = await req.text();
      if (!bodyText || bodyText.length === 0) {
        throw new Error('Request body is empty');
      }
      request = JSON.parse(bodyText);
    } catch (error) {
      if (error instanceof Error && error.message.includes('too large')) {
        throw new Error('Request body too large. This endpoint only accepts file paths, not file contents.');
      }
      throw new Error(`Invalid request body: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    if (!request.filePath || !request.targetIp) {
      throw new Error('Missing required fields: filePath and targetIp');
    }

    // Construct full file path - if filePath is just a filename, prepend uploadDir
    let fullFilePath = request.filePath;
    if (!fullFilePath.startsWith('/') && !fullFilePath.includes('..')) {
      // It's likely just a filename, construct full path
      fullFilePath = join(this.config.uploadDir, basename(fullFilePath));
    }

    // Validate file exists
    if (!existsSync(fullFilePath)) {
      throw new Error(`File not found: ${fullFilePath}`);
    }

    const targetPort = request.targetPort || this.config.port;

    // Transfer file using the file transfer client with optional target path
    const result = await this.fileTransferClient.sendFile({
      targetIp: request.targetIp,
      targetPort: targetPort,
      filePath: fullFilePath,
      fileName: request.fileName || basename(fullFilePath),
      authToken: this.config.authToken,
      targetPath: request.targetPath // Pass destination folder path
    });

    return {
      ...result,
      success: result.success,
      message: `File transferred successfully to ${request.targetIp}:${targetPort}${request.targetPath ? ` at ${request.targetPath}` : ''}`
    };
  }

  /**
   * Handle create folder request
   */
  private async handleCreateFolder(req: Request): Promise<{ success: boolean; folderPath: string; error?: string }> {
    // Check authorization if token is provided
    if (this.config.authToken) {
      const authHeader = req.headers.get('authorization');
      if (!authHeader || authHeader !== `Bearer ${this.config.authToken}`) {
        throw new Error('Unauthorized');
      }
    }

    const body = await req.json();
    const { folderName, parentPath } = body;

    if (!folderName || typeof folderName !== 'string' || folderName.trim().length === 0) {
      throw new Error('Folder name is required');
    }

    // Sanitize folder name - remove any path separators and dangerous characters
    const sanitizedFolderName = basename(folderName.trim().replace(/[\/\\]/g, '_'));

    // Determine parent directory
    const baseDir = parentPath && parentPath.trim().length > 0
      ? resolve(parentPath)
      : resolve(process.cwd());

    // Ensure parent directory exists
    if (!existsSync(baseDir)) {
      throw new Error(`Parent directory does not exist: ${baseDir}`);
    }

    const folderPath = join(baseDir, sanitizedFolderName);

    // Check if folder already exists
    if (existsSync(folderPath)) {
      throw new Error(`Folder already exists: ${sanitizedFolderName}`);
    }

    // Create the folder
    mkdirSync(folderPath, { recursive: false });

    console.log(`📁 Folder created: ${folderPath}`);

    return {
      success: true,
      folderPath: folderPath
    };
  }

  /**
   * Get file extension
   */
  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    return lastDot === -1 ? '' : fileName.slice(lastDot + 1).toLowerCase();
  }

  /**
   * Generate unique filename
   */
  private generateUniqueFileName(originalName: string): string {
    const timestamp = Date.now();
    const random = randomBytes(4).toString('hex');
    const extension = this.getFileExtension(originalName);
    const nameWithoutExt = basename(originalName, extension ? `.${extension}` : '');

    return extension
      ? `${nameWithoutExt}_${timestamp}_${random}.${extension}`
      : `${nameWithoutExt}_${timestamp}_${random}`;
  }

}
