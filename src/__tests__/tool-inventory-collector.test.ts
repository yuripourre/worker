/**
 * Tests for tool-inventory-collector — collectToolInventory with optional baseDir.
 */
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { collectToolInventory } from '../utils/tool-inventory-collector';

describe('tool-inventory-collector', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tool-inv-test-'));
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('returns empty inventory when baseDir does not exist', () => {
    const result = collectToolInventory(join(tempDir, 'nonexistent'));
    expect(result.tools).toHaveLength(0);
    expect(result.lastUpdated).toBeDefined();
  });

  test('returns empty inventory when baseDir is empty', () => {
    const result = collectToolInventory(tempDir);
    expect(result.tools).toHaveLength(0);
  });

  test('detects bash tool from .sh file', () => {
    const toolDir = join(tempDir, 'bash-tool');
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(join(toolDir, 'run.sh'), '#!/bin/bash\necho ok');
    const result = collectToolInventory(tempDir);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('bash-tool');
    expect(result.tools[0].type).toBe('bash');
  });

  test('detects typescript tool from .ts file', () => {
    const toolDir = join(tempDir, 'ts-tool');
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(join(toolDir, 'index.ts'), 'console.log("ok");');
    const result = collectToolInventory(tempDir);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('ts-tool');
    expect(result.tools[0].type).toBe('typescript');
  });

  test('detects zip tool from .zip file', () => {
    const toolDir = join(tempDir, 'zip-tool');
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(join(toolDir, 'bundle.zip'), 'pk');
    const result = collectToolInventory(tempDir);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('zip-tool');
    expect(result.tools[0].type).toBe('zip');
  });

  test('detects binary when executable bit set and no .sh/.ts/.zip', () => {
    const toolDir = join(tempDir, 'bin-tool');
    mkdirSync(toolDir, { recursive: true });
    const binPath = join(toolDir, 'run');
    writeFileSync(binPath, '#!/bin/sh\necho ok');
    chmodSync(binPath, 0o755);
    const result = collectToolInventory(tempDir);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('bin-tool');
    expect(result.tools[0].type).toBe('binary');
  });

  test('bash takes precedence over binary when both present', () => {
    const toolDir = join(tempDir, 'mixed');
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(join(toolDir, 'script.sh'), 'echo ok');
    const binPath = join(toolDir, 'run');
    writeFileSync(binPath, 'x');
    chmodSync(binPath, 0o755);
    const result = collectToolInventory(tempDir);
    expect(result.tools[0].type).toBe('bash');
  });

  test('lists multiple tools', () => {
    mkdirSync(join(tempDir, 'a'), { recursive: true });
    writeFileSync(join(tempDir, 'a', 'x.sh'), '');
    mkdirSync(join(tempDir, 'b'), { recursive: true });
    writeFileSync(join(tempDir, 'b', 'y.ts'), '');
    const result = collectToolInventory(tempDir);
    expect(result.tools).toHaveLength(2);
    const names = result.tools.map(t => t.name).sort();
    expect(names).toEqual(['a', 'b']);
  });

  test('ignores files (only directories are tools)', () => {
    writeFileSync(join(tempDir, 'file.sh'), '');
    const result = collectToolInventory(tempDir);
    expect(result.tools).toHaveLength(0);
  });
});
