#!/usr/bin/env node
// Generate docs/template-gallery.md from templates/manifest.json.
// Idempotent. Run after editing manifest.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(HERE);

function build() {
  const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'templates/manifest.json'), 'utf8'));
  const meta = manifest._meta || {};
  const rows = Object.entries(manifest)
    .filter(([k]) => k !== '_meta')
    .sort(([a], [b]) => a.localeCompare(b));

  const lines = [];
  lines.push('# Template Gallery');
  lines.push('');
  lines.push(`Generated from \`templates/manifest.json\`. Upstream: \`${meta.upstream_repo}@${meta.upstream_sha}\` (fetched ${meta.fetched_at}).`);
  lines.push('');
  lines.push('| ID | Title | Pattern | Use cases | Required slots |');
  lines.push('|----|-------|---------|-----------|----------------|');
  for (const [id, e] of rows) {
    const reqSlots = Object.entries(e.slots || {})
      .filter(([, s]) => (typeof s === 'object' ? s.required : false))
      .map(([n]) => `\`${n}\``)
      .join(', ') || '—';
    const use = (e.use_cases || []).map((u) => `"${u}"`).join(', ');
    lines.push(`| \`${id}\` | ${e.title} | \`${e.pattern}\` | ${use} | ${reqSlots} |`);
  }
  lines.push('');
  lines.push(`_${rows.length} templates._`);
  lines.push('');
  return lines.join('\n');
}

function main() {
  const out = join(PLUGIN_ROOT, 'docs/template-gallery.md');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, build(), 'utf8');
  process.stdout.write(out + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
