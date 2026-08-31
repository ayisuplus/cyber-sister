import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts', 'verify-model-assets.mjs');
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'makeup-model-assets-'));
  tempDirs.push(dir);
  return dir;
}

function runVerifier(source: string, target: string, lock: string) {
  return spawnSync(process.execPath, [SCRIPT, source, target, lock], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('受控模型资产校验', () => {
  it('SHA-256 匹配后才复制清单文件', () => {
    const root = tempDir();
    const source = join(root, 'source');
    const target = join(root, 'target');
    const lock = join(root, 'lock.json');
    mkdirSync(join(source, 'wasm'), { recursive: true });
    const bytes = Buffer.from('approved-model-bytes');
    writeFileSync(join(source, 'wasm', 'model.wasm'), bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(lock, JSON.stringify({ files: [{ path: 'wasm/model.wasm', sha256 }] }));

    const result = runVerifier(source, target, lock);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('verified 1 controlled model assets');
    expect(existsSync(join(target, 'wasm', 'model.wasm'))).toBe(true);
    expect(readFileSync(join(target, 'wasm', 'model.wasm'))).toEqual(bytes);
  });

  it('摘要不匹配时给出 expected/received 且不复制', () => {
    const root = tempDir();
    const source = join(root, 'source');
    const target = join(root, 'target');
    const lock = join(root, 'lock.json');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'model.task'), 'unexpected');
    writeFileSync(
      lock,
      JSON.stringify({ files: [{ path: 'model.task', sha256: '0'.repeat(64) }] }),
    );

    const result = runVerifier(source, target, lock);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SHA-256 mismatch for model.task');
    expect(result.stderr).toContain('expected');
    expect(result.stderr).toContain('received');
    expect(existsSync(join(target, 'model.task'))).toBe(false);
  });

  it('拒绝越出受控目录的清单路径', () => {
    const root = tempDir();
    const source = join(root, 'source');
    const target = join(root, 'target');
    const lock = join(root, 'lock.json');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      lock,
      JSON.stringify({ files: [{ path: '../outside.task', sha256: '0'.repeat(64) }] }),
    );

    const result = runVerifier(source, target, lock);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must stay inside the controlled directory');
  });
});
