import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTmpDir, cleanup, withTmp, ROOT } from '../../plugins/html-effectiveness/scripts/_tmp.js';

test('getTmpDir creates a fresh dir under .tmp/html-effectiveness/', () => {
  const dir = getTmpDir('unit-a');
  assert.ok(dir.endsWith('/.tmp/html-effectiveness/unit-a'));
  assert.ok(existsSync(dir));
  cleanup('unit-a');
});

test('getTmpDir wipes existing dir contents', () => {
  const dir = getTmpDir('unit-b');
  writeFileSync(join(dir, 'old.txt'), 'stale');
  const dir2 = getTmpDir('unit-b');
  assert.equal(dir, dir2);
  assert.equal(existsSync(join(dir2, 'old.txt')), false);
  cleanup('unit-b');
});

test('cleanup removes dir', () => {
  const dir = getTmpDir('unit-c');
  cleanup('unit-c');
  assert.equal(existsSync(dir), false);
});

test('cleanup is idempotent on missing dir', () => {
  cleanup('unit-never-created');
  assert.ok(true);
});

test('withTmp runs callback and cleans up on success', () => {
  let observed;
  const result = withTmp('unit-d', (dir) => {
    observed = dir;
    writeFileSync(join(dir, 'x'), 'y');
    return 'done';
  });
  assert.equal(result, 'done');
  assert.equal(existsSync(observed), false);
});

test('withTmp cleans up even when callback throws', () => {
  let observed;
  assert.throws(() => {
    withTmp('unit-e', (dir) => {
      observed = dir;
      throw new Error('boom');
    });
  }, /boom/);
  assert.equal(existsSync(observed), false);
});

test('ROOT is anchored at repo .tmp/html-effectiveness', () => {
  assert.ok(ROOT.endsWith('/.tmp/html-effectiveness'));
});
