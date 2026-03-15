import { readFileSync, statSync } from 'fs';
import { basename } from 'path';

export interface FileTransferClientOptions {
  timeout?: number;
}

export interface SendFileOptions {
  targetIp: string;
  targetPort: number;
  filePath: string;
  fileName?: string;
  authToken?: string;
  targetPath?: string;
}

export interface SendFileResult {
  success: boolean;
  fileName: string;
  fileSize: number;
  path?: string;
}

const HEALTH_PATH = '/health';
const UPLOAD_PATH = '/upload';

/**
 * Client used by a worker to push files directly to another worker's
 * FileTransferService over the local network (P2P).
 */
export class FileTransferClient {
  private readonly timeout: number;

  constructor(options: FileTransferClientOptions = {}) {
    this.timeout = options.timeout ?? 30000;
  }

  async testConnection(ip: string, port: number): Promise<boolean> {
    const url = `http://${ip}:${port}${HEALTH_PATH}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  async sendFile(options: SendFileOptions): Promise<SendFileResult> {
    const { targetIp, targetPort, filePath, fileName, authToken, targetPath } = options;
    const url = `http://${targetIp}:${targetPort}${UPLOAD_PATH}`;

    const fileBuffer = readFileSync(filePath);
    const resolvedName = fileName ?? basename(filePath);

    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), resolvedName);
    formData.append('fileName', resolvedName);
    if (targetPath) formData.append('targetPath', targetPath);

    const headers: Record<string, string> = {};
    if (authToken) headers['x-auth-token'] = authToken;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', body: formData, headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      throw new Error(`File transfer failed (${res.status}): ${body}`);
    }

    const json = await res.json() as SendFileResult;
    return json;
  }
}
