import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../scripts/render.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

function setup() {
  const out = mkdtempSync(join(tmpdir(), 'htmleff-'));
  return {
    out,
    cleanup: () => rmSync(out, { recursive: true, force: true }),
  };
}

test('renders canned template into self-contained HTML', () => {
  const { out, cleanup } = setup();
  try {
    const outPath = join(out, 'demo.html');
    renderReport({
      templateId: '_canned',
      data: JSON.parse(readFileSync(join(fixtures, '_canned.data.json'), 'utf8')),
      outPath,
      manifestPath: join(fixtures, '_canned.manifest.json'),
      pluginRoot: dirname(fixtures),
    });
    const html = readFileSync(outPath, 'utf8');
    assert.ok(html.startsWith('<!doctype html>'), 'starts with doctype');
    assert.ok(html.includes('<title>Demo &lt;Report&gt;</title>'), 'title escaped in head');
    assert.ok(html.includes('Demo &lt;Report&gt;</h1>'), 'title escaped in body');
    assert.ok(html.includes('<b>bold</b>'), 'html slot rendered raw');
    assert.ok(!html.match(/\{\{[^}]+\}\}/), 'no leftover mustache markers');
    assert.ok(!html.includes('<link'), 'no external link');
    assert.ok(!html.match(/<script\s+src=/i), 'no external script src');
  } finally {
    cleanup();
  }
});

test('writes sidecar .data.json next to output', () => {
  const { out, cleanup } = setup();
  try {
    const outPath = join(out, 'demo.html');
    const data = JSON.parse(readFileSync(join(fixtures, '_canned.data.json'), 'utf8'));
    renderReport({
      templateId: '_canned',
      data,
      outPath,
      manifestPath: join(fixtures, '_canned.manifest.json'),
      pluginRoot: dirname(fixtures),
    });
    const sidecarPath = outPath + '.data.json';
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
    assert.equal(sidecar.template, '_canned');
    assert.deepEqual(sidecar.data, data);
    assert.ok(sidecar.rendered_at);
  } finally {
    cleanup();
  }
});

test('throws on missing required slot with template:slot context', () => {
  const { out, cleanup } = setup();
  try {
    assert.throws(
      () => renderReport({
        templateId: '_canned',
        data: { items: [] },
        outPath: join(out, 'x.html'),
        manifestPath: join(fixtures, '_canned.manifest.json'),
        pluginRoot: dirname(fixtures),
      }),
      /_canned:title.*required/,
    );
  } finally {
    cleanup();
  }
});

test('throws on unknown template id with valid-ids list', () => {
  const { out, cleanup } = setup();
  try {
    assert.throws(
      () => renderReport({
        templateId: 'does-not-exist',
        data: {},
        outPath: join(out, 'x.html'),
        manifestPath: join(fixtures, '_canned.manifest.json'),
        pluginRoot: dirname(fixtures),
      }),
      /template not found.*_canned/i,
    );
  } finally {
    cleanup();
  }
});

test('inverted section renders fallback when array empty', () => {
  const { out, cleanup } = setup();
  try {
    const outPath = join(out, 'empty.html');
    renderReport({
      templateId: '_canned',
      data: { title: 'Empty', items: [] },
      outPath,
      manifestPath: join(fixtures, '_canned.manifest.json'),
      pluginRoot: dirname(fixtures),
    });
    const html = readFileSync(outPath, 'utf8');
    assert.ok(html.includes('No items.'));
  } finally {
    cleanup();
  }
});
