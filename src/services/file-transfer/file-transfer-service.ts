import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname, basename, extname } from 'path';

export interface FileTransferServiceOptions {
  serverPort: number;
  uploadDir: string;
  clientTimeout?: number;
  authToken?: string;
}

export interface FileTransferStatus {
  running: boolean;
  port: number;
  uploadDir: string;
}

const HEALTH_PATH = '/health';
const UPLOAD_PATH = '/upload';

/**
 * Lightweight HTTP server running on a worker that accepts incoming file pushes
 * from other workers via FileTransferClient. Uses Bun.serve() for streaming.
 */
export class FileTransferService {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private readonly options: Required<FileTransferServiceOptions>;

  constructor(options: FileTransferServiceOptions) {
    this.options = {
      clientTimeout: 30000,
      authToken: '',
      ...options,
    };
  }

  async start(): Promise<void> {
    if (this.server) return;

    mkdirSync(this.options.uploadDir, { recursive: true });

    this.server = Bun.serve({
      port: this.options.serverPort,
      fetch: (req) => this.handleRequest(req),
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getServerPort(): number {
    return this.options.serverPort;
  }

  getStatus(): FileTransferStatus {
    return {
      running: this.isRunning(),
      port: this.options.serverPort,
      uploadDir: this.options.uploadDir,
    };
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === HEALTH_PATH && req.method === 'GET') {
      return Response.json({ status: 'ok', port: this.options.serverPort });
    }

    if (url.pathname === UPLOAD_PATH && req.method === 'POST') {
      return this.handleUpload(req);
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleUpload(req: Request): Promise<Response> {
    if (this.options.authToken) {
      const token = req.headers.get('x-auth-token') ?? req.headers.get('authorization')?.replace('Bearer ', '');
      if (token !== this.options.authToken) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return Response.json({ error: 'Failed to parse form data' }, { status: 400 });
    }

    const file = formData.get('file') as File | null;
    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    const targetPath = (formData.get('targetPath') as string | null) ?? '';
    const requestedName = (formData.get('fileName') as string | null) ?? file.name ?? 'upload';

    const destDir = targetPath
      ? join(this.options.uploadDir, targetPath)
      : this.options.uploadDir;
    mkdirSync(destDir, { recursive: true });

    const safeFileName = this.makeUniqueFileName(destDir, requestedName);
    const destPath = join(destDir, safeFileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(destPath, buffer);

    return Response.json({
      success: true,
      fileName: safeFileName,
      fileSize: buffer.length,
      path: destPath,
    });
  }

  private makeUniqueFileName(dir: string, name: string): string {
    const ext = extname(name);
    const base = basename(name, ext);
    const candidate = name;
    if (!existsSync(join(dir, candidate))) return candidate;
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 10000);
    return `${base}_${ts}_${rand}${ext}`;
  }
}
