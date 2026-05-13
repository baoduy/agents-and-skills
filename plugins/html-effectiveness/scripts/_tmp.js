import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
export const ROOT = join(REPO_ROOT, '.tmp', 'html-effectiveness');

export function getTmpDir(purpose) {
  if (!purpose || /[\\/]/.test(purpose)) {
    throw new Error(`purpose must be a single path segment, got: ${purpose}`);
  }
  const dir = join(ROOT, purpose);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanup(purpose) {
  rmSync(join(ROOT, purpose), { recursive: true, force: true });
}

export function withTmp(purpose, fn) {
  const dir = getTmpDir(purpose);
  const onSig = () => {
    try { cleanup(purpose); } finally { process.exit(130); }
  };
  process.once('SIGINT', onSig);
  process.once('SIGTERM', onSig);
  try {
    return fn(dir);
  } finally {
    cleanup(purpose);
    process.off('SIGINT', onSig);
    process.off('SIGTERM', onSig);
  }
}
