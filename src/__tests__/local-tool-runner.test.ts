/**
 * Tests for local-tool-runner — runLocalTool with optional baseDir.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runLocalTool } from '../execution/local-tool-runner';

describe('local-tool-runner', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'local-tool-test-'));
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('throws when tool directory does not exist', async () => {
    await expect(
      runLocalTool('missing', { x: 1 }, undefined, { baseDir: tempDir })
    ).rejects.toThrow(/not installed.*directory not found/);
  });

  test('throws when no entry point found', async () => {
    const toolDir = join(tempDir, 'no-entry');
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(join(toolDir, 'a.txt'), 'x');
    writeFileSync(join(toolDir, 'b.txt'), 'y');
    await expect(
      runLocalTool('no-entry', {}, undefined, { baseDir: tempDir })
    ).rejects.toThrow(/Could not find entry point/);
  });

  test('runs bash script and returns stdout', async () => {
    const toolDir = join(tempDir, 'echo-tool');
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(
      join(toolDir, 'index.sh'),
      '#!/bin/bash\nread -r input; echo "out:$input"'
    );
    const result = await runLocalTool(
      'echo-tool',
      { msg: 'hello' },
      undefined,
      { baseDir: tempDir }
    );
    expect(result).toContain('out:');
    expect(result).toContain('"msg":"hello"');
  });

  test('uses explicit entryPoint when provided', async () => {
    const toolDir = join(tempDir, 'multi');
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(join(toolDir, 'index.sh'), '#!/bin/bash\necho wrong');
    writeFileSync(
      join(toolDir, 'main.sh'),
      '#!/bin/bash\nread -r; echo "correct"'
    );
    const result = await runLocalTool(
      'multi',
      {},
      'main.sh',
      { baseDir: tempDir }
    );
    expect(result.trim()).toBe('correct');
  });

  test('rejects when script exits non-zero', async () => {
    const toolDir = join(tempDir, 'fail-tool');
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(join(toolDir, 'index.sh'), '#!/bin/bash\necho err >&2; exit 1');
    await expect(
      runLocalTool('fail-tool', {}, undefined, { baseDir: tempDir })
    ).rejects.toThrow(/exited with code 1/);
  });

  test('runs typescript with bun and returns stdout', async () => {
    const toolDir = join(tempDir, 'ts-tool');
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(
      join(toolDir, 'index.ts'),
      'console.log(JSON.stringify({ ok: true }));'
    );
    const result = await runLocalTool(
      'ts-tool',
      {},
      undefined,
      { baseDir: tempDir }
    );
    expect(result).toContain('ok');
    expect(result).toContain('true');
  });
});
