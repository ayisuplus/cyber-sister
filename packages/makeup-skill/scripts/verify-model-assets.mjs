import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';

const [sourceArg = '.assets', targetArg = 'public/mp-models', lockArg = 'model-assets.lock.json'] =
  process.argv.slice(2);
const sourceDir = resolve(sourceArg);
const targetDir = resolve(targetArg);
const lockPath = resolve(lockArg);
let manifest;
try {
  manifest = JSON.parse(readFileSync(lockPath, 'utf8'));
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  throw new Error(`cannot read controlled model asset manifest ${lockPath}: ${detail}`);
}

if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  throw new Error('model-assets.lock.json must contain a non-empty files array');
}

for (const entry of manifest.files) {
  if (!entry || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
    throw new Error('invalid model asset manifest entry');
  }
  const normalizedPath = normalize(entry.path);
  if (
    isAbsolute(entry.path) ||
    normalizedPath === '..' ||
    normalizedPath.startsWith(`..${sep}`)
  ) {
    throw new Error(`model asset path must stay inside the controlled directory: ${entry.path}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    throw new Error(
      `approved SHA-256 is missing or invalid for ${entry.path}; update model-assets.lock.json after asset approval`,
    );
  }
  const source = join(sourceDir, normalizedPath);
  if (!statSync(source, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`controlled model asset is missing: ${entry.path} (expected at ${source})`);
  }
  const actual = createHash('sha256').update(readFileSync(source)).digest('hex');
  if (actual !== entry.sha256.toLowerCase()) {
    throw new Error(`SHA-256 mismatch for ${entry.path}: expected ${entry.sha256}, received ${actual}`);
  }
  const target = join(targetDir, normalizedPath);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

console.info(`verified ${manifest.files.length} controlled model assets`);
