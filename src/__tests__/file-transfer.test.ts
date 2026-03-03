import { FileTransferService } from '../services/file-transfer/file-transfer-service';
import { FileTransferClient } from '../services/file-transfer/file-transfer-client';
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

// File transfer tests require Bun.serve (LocalServer); skip when running under Jest/Node
const describeFileTransfer = typeof (globalThis as unknown as { Bun?: unknown }).Bun !== 'undefined' ? describe : describe.skip;

describeFileTransfer('File Transfer System', () => {
  let fileTransferService: FileTransferService;
  let client: FileTransferClient;
  const testDir = './test-uploads';
  const tempDir = './test-temp';

  beforeAll(async () => {
    // Create test directories
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

    // Initialize file transfer service
    fileTransferService = new FileTransferService({
      serverPort: 8081, // Use different port to avoid conflicts
      uploadDir: testDir,
      clientTimeout: 10000,
      authToken: 'test-token'
    });

    // Initialize client
    client = new FileTransferClient({
      timeout: 10000
    });

    // Start the service
    await fileTransferService.start();
  });

  afterAll(async () => {
    // Cleanup
    await fileTransferService.stop();
    
    // Remove test files
    try {
      if (existsSync(testDir)) {
        const files = require('fs').readdirSync(testDir);
        files.forEach((file: string) => unlinkSync(join(testDir, file)));
      }
      if (existsSync(tempDir)) {
        const files = require('fs').readdirSync(tempDir);
        files.forEach((file: string) => unlinkSync(join(tempDir, file)));
      }
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
  });

  test('should start file transfer service', () => {
    expect(fileTransferService.isRunning()).toBe(true);
    expect(fileTransferService.getServerPort()).toBe(8081);
  });

  test('should test connection to file transfer server', async () => {
    const isConnected = await client.testConnection('localhost', 8081);
    expect(isConnected).toBe(true);
  });

  test('should send file successfully', async () => {
    // Create test file
    const testContent = 'Hello, this is a test file for transfer!';
    const testFilePath = join(tempDir, 'test-file.txt');
    writeFileSync(testFilePath, testContent);

    // Send file (server returns a unique filename e.g. transferred-file_timestamp_random.txt)
    const result = await client.sendFile({
      targetIp: 'localhost',
      targetPort: 8081,
      filePath: testFilePath,
      fileName: 'transferred-file.txt',
      authToken: 'test-token',
      targetPath: testDir
    });

    expect(result.success).toBe(true);
    expect(result.fileName).toContain('transferred-file');
    expect(result.fileName).toMatch(/\.txt$/);
    expect(result.fileSize).toBeGreaterThan(0);
  });

  test('should handle authentication failure', async () => {
    const testFilePath = join(tempDir, 'auth-test.txt');
    writeFileSync(testFilePath, 'test content');

    await expect(
      client.sendFile({
        targetIp: 'localhost',
        targetPort: 8081,
        filePath: testFilePath,
        fileName: 'auth-test.txt',
        authToken: 'wrong-token'
      })
    ).rejects.toThrow();
  });

  test('should accept large files', async () => {
    // Current implementation allows large uploads (e.g. for model files). Verify 2MB succeeds.
    const largeContent = 'x'.repeat(2 * 1024 * 1024); // 2MB
    const largeFilePath = join(tempDir, 'large-file.txt');
    writeFileSync(largeFilePath, largeContent);

    const result = await client.sendFile({
      targetIp: 'localhost',
      targetPort: 8081,
      filePath: largeFilePath,
      fileName: 'large-file.txt',
      authToken: 'test-token',
      targetPath: testDir
    });

    expect(result.success).toBe(true);
    expect(result.fileSize).toBe(2 * 1024 * 1024);
  });

  test('should accept any file type', async () => {
    // Current implementation does not restrict by extension (e.g. .exe allowed for tools).
    const testFilePath = join(tempDir, 'binary.exe');
    writeFileSync(testFilePath, 'binary content');

    const result = await client.sendFile({
      targetIp: 'localhost',
      targetPort: 8081,
      filePath: testFilePath,
      fileName: 'binary.exe',
      authToken: 'test-token',
      targetPath: testDir
    });

    expect(result.success).toBe(true);
    expect(result.fileName).toContain('binary');
    expect(result.fileName).toMatch(/\.exe$/);
    expect(result.fileSize).toBeGreaterThan(0);
  });

  test('should get service status', () => {
    const status = fileTransferService.getStatus();
    expect(status.running).toBe(true);
    expect(status.port).toBe(8081);
    expect(status.uploadDir).toBe(testDir);
  });
});
