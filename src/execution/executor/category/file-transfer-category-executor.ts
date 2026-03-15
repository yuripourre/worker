import { ExecutableJob, ExecutableJobResult } from '../../types';
import { CategoryExecutor } from './category-executor';
import {
  isFileTransferJobContext,
  FileTransferJobContext,
  JobCategory,
  FILE_TRANSFER_CONFIG,
} from '../../../shared';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  openSync,
  writeSync,
  closeSync,
} from 'fs';
import { join, dirname, basename } from 'path';
import { createHash } from 'crypto';
import { homedir } from 'os';

interface TransferState {
  receivedChunks: number[];
  totalChunks: number;
  tempPath: string;
  destinationPath: string;
  checksum: string;
  fileName: string;
  complete: boolean;
}

interface ActiveP2PServer {
  server: ReturnType<typeof Bun.serve>;
  cleanup: ReturnType<typeof setTimeout>;
}

/**
 * Executes FILE_TRANSFER jobs for worker-to-worker file transfers.
 *
 * 'send' operation (processed by the sending worker):
 *   - Reads the source file and computes SHA256
 *   - Starts a temporary P2P HTTP server (sender serves the file directly)
 *   - Uploads each chunk as an artifact to the sender's own job
 *   - Creates one 'receive_chunk' job per chunk for the receiving worker,
 *     including the P2P URL so the receiver can try direct download first
 *
 * 'receive_chunk' operation (processed by the receiving worker):
 *   - If senderDirectUrl is set, tries a full P2P download first (5s timeout)
 *   - Falls back to downloading the chunk artifact from the job server
 *   - Writes the chunk at the correct byte offset in a temp file
 *   - Tracks received chunks in a local state file; when all chunks arrive,
 *     verifies SHA256 and moves the file to destinationPath
 */
export class FileTransferCategoryExecutor implements CategoryExecutor {
  private readonly p2pServers = new Map<string, ActiveP2PServer>();

  constructor(
    private readonly baseUrl?: string,
    private readonly deviceId?: string,
    private readonly workerId?: string,
    private readonly ipAddress?: string
  ) {}

  async executeExecution(job: ExecutableJob): Promise<ExecutableJobResult> {
    if (!isFileTransferJobContext(job.context)) {
      throw new Error('FileTransfer context is required for file_transfer jobs');
    }

    try {
      switch (job.context.operation) {
        case 'send':
          return await this.executeSend(job.id, job.context);
        case 'receive_chunk':
          return await this.executeReceiveChunk(job.context);
        default:
          throw new Error(`Unknown file transfer operation: ${(job.context as FileTransferJobContext).operation}`);
      }
    } catch (err) {
      return {
        status: 'failed',
        answer: `File transfer failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  private async executeSend(jobId: string, ctx: FileTransferJobContext): Promise<ExecutableJobResult> {
    const { sourcePath, receiverWorkerId, receiverDeviceId, transferId, fileName, destinationPath } = ctx;

    if (!sourcePath) throw new Error('sourcePath is required for send operation');
    if (!receiverWorkerId && !receiverDeviceId) {
      throw new Error('receiverWorkerId or receiverDeviceId is required for send operation');
    }
    if (!this.baseUrl) throw new Error('baseUrl is required for send operation');
    if (!jobId) throw new Error('jobId is required for send operation');
    if (!existsSync(sourcePath)) throw new Error(`Source file not found: ${sourcePath}`);

    const fileBuffer = readFileSync(sourcePath);
    const fileChecksum = createHash('sha256').update(fileBuffer).digest('hex');
    const totalSize = fileBuffer.length;
    const chunkSize = ctx.chunkSizeBytes ?? FILE_TRANSFER_CONFIG.CHUNK_SIZE_BYTES;
    const totalChunks = Math.ceil(totalSize / chunkSize) || 1;
    const targetFileName = fileName || basename(sourcePath);

    const p2pPort = await this.startP2PServer(transferId, fileBuffer);
    const senderDirectUrl =
      this.ipAddress && p2pPort !== undefined
        ? `http://${this.ipAddress}:${p2pPort}/transfer/${transferId}/file`
        : undefined;

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalSize);
      const chunk = fileBuffer.subarray(start, end);
      const chunkChecksum = createHash('sha256').update(chunk).digest('hex');
      const chunkName = `chunk_${i}.bin`;

      const formData = new FormData();
      formData.append('file', new Blob([chunk]), chunkName);
      const uploadRes = await fetch(`${this.baseUrl}/api/jobs/${jobId}/artifacts`, {
        method: 'POST',
        body: formData,
      });
      if (!uploadRes.ok) {
        throw new Error(`Failed to upload chunk ${i}: ${uploadRes.statusText}`);
      }

      const receiveCtx: FileTransferJobContext = {
        category: JobCategory.FILE_TRANSFER,
        operation: 'receive_chunk',
        transferId,
        fileName: targetFileName,
        destinationPath,
        fileChecksum,
        totalSize,
        chunkIndex: i,
        totalChunks,
        chunkArtifactJobId: jobId,
        chunkArtifactName: chunkName,
        chunkChecksum,
        senderDirectUrl,
      };

      const createRes = await fetch(`${this.baseUrl}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: receiveCtx,
          category: JobCategory.FILE_TRANSFER,
          assignedWorkerId: receiverWorkerId,
          assignedDeviceId: receiverDeviceId,
        }),
      });
      if (!createRes.ok) {
        throw new Error(`Failed to create receive_chunk job ${i}: ${createRes.statusText}`);
      }
    }

    return {
      status: 'success',
      answer: JSON.stringify({
        transferId,
        totalChunks,
        totalSize,
        fileChecksum,
        p2pEnabled: !!senderDirectUrl,
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Receive chunk
  // ---------------------------------------------------------------------------

  private async executeReceiveChunk(ctx: FileTransferJobContext): Promise<ExecutableJobResult> {
    const {
      transferId,
      chunkIndex,
      totalChunks,
      chunkArtifactJobId,
      chunkArtifactName,
      fileChecksum,
      totalSize,
      destinationPath,
      fileName,
      chunkChecksum,
      senderDirectUrl,
      chunkSizeBytes,
    } = ctx;

    if (chunkIndex === undefined || totalChunks === undefined) {
      throw new Error('chunkIndex and totalChunks are required for receive_chunk operation');
    }

    const stateDir = join(homedir(), FILE_TRANSFER_CONFIG.TRANSFER_STATE_DIR, transferId);
    const stateFile = join(stateDir, 'state.json');
    const tempFile = join(stateDir, `${fileName}.part`);

    mkdirSync(stateDir, { recursive: true });

    const existing = this.loadState(stateFile);
    if (existing?.complete) {
      return {
        status: 'success',
        answer: JSON.stringify({ transferId, skipped: true, alreadyComplete: true }),
      };
    }

    // P2P path: the first chunk job that succeeds via direct download claims the whole transfer.
    if (senderDirectUrl) {
      const p2pOk = await this.tryP2PDownload(senderDirectUrl, tempFile, fileChecksum, totalSize);
      if (p2pOk) {
        mkdirSync(dirname(destinationPath), { recursive: true });
        renameSync(tempFile, destinationPath);
        this.markComplete(stateFile, { totalChunks, tempPath: tempFile, destinationPath, checksum: fileChecksum, fileName: fileName ?? '', receivedChunks: Array.from({ length: totalChunks }, (_, k) => k) });
        return {
          status: 'success',
          answer: JSON.stringify({ transferId, method: 'p2p', destination: destinationPath }),
        };
      }
    }

    // Server-tunnel path: download chunk artifact and write at byte offset.
    if (!chunkArtifactJobId || !chunkArtifactName) {
      throw new Error('chunkArtifactJobId and chunkArtifactName are required for server-tunnel receive');
    }
    if (!this.baseUrl) throw new Error('baseUrl is required to download chunk artifacts');

    const artifactUrl = `${this.baseUrl}/api/jobs/${chunkArtifactJobId}/artifacts/${encodeURIComponent(chunkArtifactName)}`;
    const chunkRes = await fetch(artifactUrl);
    if (!chunkRes.ok) {
      throw new Error(`Failed to download chunk ${chunkIndex}: ${chunkRes.statusText}`);
    }
    const chunkData = Buffer.from(await chunkRes.arrayBuffer());

    if (chunkChecksum) {
      const actual = createHash('sha256').update(chunkData).digest('hex');
      if (actual !== chunkChecksum) {
        throw new Error(`Chunk ${chunkIndex} checksum mismatch: expected ${chunkChecksum}, got ${actual}`);
      }
    }

    const effectiveChunkSize = chunkSizeBytes ?? FILE_TRANSFER_CONFIG.CHUNK_SIZE_BYTES;
    const offset = chunkIndex * effectiveChunkSize;

    if (!existsSync(tempFile)) {
      writeFileSync(tempFile, Buffer.alloc(0));
    }
    const fd = openSync(tempFile, 'r+');
    writeSync(fd, chunkData, 0, chunkData.length, offset);
    closeSync(fd);

    const updatedState = this.updateState(stateFile, {
      chunkIndex,
      totalChunks,
      tempPath: tempFile,
      destinationPath,
      checksum: fileChecksum,
      fileName: fileName ?? '',
    });

    if (updatedState.receivedChunks.length === totalChunks) {
      const assembled = readFileSync(tempFile);
      const actual = createHash('sha256').update(assembled).digest('hex');
      if (actual !== fileChecksum) {
        throw new Error(`File checksum mismatch after assembly: expected ${fileChecksum}, got ${actual}`);
      }
      mkdirSync(dirname(destinationPath), { recursive: true });
      renameSync(tempFile, destinationPath);
      this.markComplete(stateFile, updatedState);
      return {
        status: 'success',
        answer: JSON.stringify({
          transferId,
          method: 'server-tunnel',
          destination: destinationPath,
          complete: true,
        }),
      };
    }

    return {
      status: 'success',
      answer: JSON.stringify({
        transferId,
        chunkIndex,
        receivedChunks: updatedState.receivedChunks.length,
        totalChunks,
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // P2P helpers
  // ---------------------------------------------------------------------------

  private async tryP2PDownload(
    url: string,
    tempFile: string,
    expectedChecksum: string,
    totalSize: number
  ): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        FILE_TRANSFER_CONFIG.P2P_CONNECT_TIMEOUT_MS
      );
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) return false;

      const data = Buffer.from(await res.arrayBuffer());
      if (data.length !== totalSize) return false;

      const checksum = createHash('sha256').update(data).digest('hex');
      if (checksum !== expectedChecksum) return false;

      writeFileSync(tempFile, data);
      return true;
    } catch {
      return false;
    }
  }

  private async startP2PServer(transferId: string, fileBuffer: Buffer): Promise<number | undefined> {
    const port = 50000 + Math.floor(Math.random() * 10000);
    try {
      const server = Bun.serve({
        port,
        fetch: (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === `/transfer/${transferId}/file` && req.method === 'GET') {
            return new Response(fileBuffer.buffer as ArrayBuffer, {
              headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(fileBuffer.length),
              },
            });
          }
          return new Response('Not Found', { status: 404 });
        },
      });

      const cleanup = setTimeout(() => {
        server.stop(true);
        this.p2pServers.delete(transferId);
      }, FILE_TRANSFER_CONFIG.P2P_SERVER_TIMEOUT_MS);

      this.p2pServers.set(transferId, { server, cleanup });
      return port;
    } catch {
      return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // State file helpers (atomic write via temp → rename)
  // ---------------------------------------------------------------------------

  private loadState(stateFile: string): TransferState | null {
    try {
      if (!existsSync(stateFile)) return null;
      return JSON.parse(readFileSync(stateFile, 'utf-8')) as TransferState;
    } catch {
      return null;
    }
  }

  private saveState(stateFile: string, state: TransferState): void {
    const tmp = stateFile + '.tmp';
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, stateFile);
  }

  private updateState(
    stateFile: string,
    params: {
      chunkIndex: number;
      totalChunks: number;
      tempPath: string;
      destinationPath: string;
      checksum: string;
      fileName: string;
    }
  ): TransferState {
    const existing = this.loadState(stateFile);
    const receivedChunks = existing?.receivedChunks ?? [];
    if (!receivedChunks.includes(params.chunkIndex)) {
      receivedChunks.push(params.chunkIndex);
    }
    const state: TransferState = {
      receivedChunks,
      totalChunks: params.totalChunks,
      tempPath: params.tempPath,
      destinationPath: params.destinationPath,
      checksum: params.checksum,
      fileName: params.fileName,
      complete: false,
    };
    this.saveState(stateFile, state);
    return state;
  }

  private markComplete(stateFile: string, partial: Partial<TransferState>): void {
    const existing = this.loadState(stateFile) ?? ({} as TransferState);
    this.saveState(stateFile, { ...existing, ...partial, complete: true });
  }
}
