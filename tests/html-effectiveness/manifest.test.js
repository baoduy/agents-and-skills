import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(HERE, '..', '..', 'plugins', 'html-effectiveness');
const MANIFEST = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'templates/manifest.json'), 'utf8'));
const VALID_BUNDLES = new Set(['base', 'components', 'charts']);

const entries = Object.entries(MANIFEST).filter(([k]) => k !== '_meta');

test('manifest declares 20 vendored templates', () => {
  assert.equal(entries.length, 20, `expected 20 entries, got ${entries.length}`);
});

test('_meta records upstream SHA and fetch date', () => {
  const meta = MANIFEST._meta;
  assert.ok(meta, '_meta missing');
  assert.match(meta.upstream_sha, /^[0-9a-f]{40}$/, 'upstream_sha must be 40-char hex');
  assert.match(meta.fetched_at, /^\d{4}-\d{2}-\d{2}$/, 'fetched_at must be YYYY-MM-DD');
  assert.equal(meta.upstream_repo, 'ThariqS/html-effectiveness');
});

for (const [id, entry] of entries) {
  test(`${id}: required fields present`, () => {
    for (const f of ['title', 'use_cases', 'pattern', 'slots', 'asset_bundles']) {
      assert.ok(f in entry, `${id} missing field "${f}"`);
    }
    assert.ok(Array.isArray(entry.use_cases), `${id} use_cases must be array`);
    assert.ok(entry.use_cases.length > 0, `${id} use_cases must be non-empty`);
    assert.equal(typeof entry.pattern, 'string', `${id} pattern must be string`);
    assert.equal(typeof entry.slots, 'object', `${id} slots must be object`);
  });

  test(`${id}: asset_bundles valid`, () => {
    assert.ok(Array.isArray(entry.asset_bundles), `${id} asset_bundles not array`);
    for (const b of entry.asset_bundles) {
      assert.ok(VALID_BUNDLES.has(b), `${id} asset_bundles contains invalid "${b}"`);
    }
  });

  test(`${id}: template file exists`, () => {
    const tmplRel = entry.tmpl || `templates/${id}.html.tmpl`;
    const tmplAbs = join(PLUGIN_ROOT, tmplRel);
    assert.ok(existsSync(tmplAbs), `${id} template file missing: ${tmplRel}`);
  });

  test(`${id}: fixture file exists`, () => {
    const fix = join(HERE, `fixtures/${id}.data.json`);
    assert.ok(existsSync(fix), `${id} fixture missing: fixtures/${id}.data.json`);
    const data = JSON.parse(readFileSync(fix, 'utf8'));
    for (const [slot, schemaRaw] of Object.entries(entry.slots)) {
      const schema = typeof schemaRaw === 'string' ? { type: schemaRaw } : schemaRaw;
      if (schema.required) {
        assert.ok(slot in data, `${id} fixture missing required slot "${slot}"`);
      }
    }
  });
}
