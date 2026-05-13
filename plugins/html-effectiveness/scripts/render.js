#!/usr/bin/env node
// CLI + library: render a template + data into a self-contained HTML file.
// Exit codes: 0 ok, 1 generic, 2 template-not-found, 3 slot schema mismatch, 4 fs write error.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { render as mustache } from './mustache.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = dirname(SCRIPT_DIR);

const ASSET_BUNDLES = {
  base: { css: 'assets/base.css', js: 'assets/base.js' },
  components: { css: 'assets/components.css' },
  charts: { js: 'assets/charts.js' },
};

function validateSlot(templateId, slotPath, schema, value) {
  if (schema.required && (value === undefined || value === null)) {
    const err = new Error(`${templateId}:${slotPath} required but missing`);
    err.code = 3;
    throw err;
  }
  if (value === undefined || value === null) return;
  const type = schema.type;
  if (type === 'string' || type === 'html') {
    if (typeof value !== 'string') {
      const err = new Error(`${templateId}:${slotPath} expected string got ${typeof value}`);
      err.code = 3;
      throw err;
    }
  } else if (type === 'number') {
    if (typeof value !== 'number') {
      const err = new Error(`${templateId}:${slotPath} expected number got ${typeof value}`);
      err.code = 3;
      throw err;
    }
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      const err = new Error(`${templateId}:${slotPath} expected boolean got ${typeof value}`);
      err.code = 3;
      throw err;
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) {
      const err = new Error(`${templateId}:${slotPath} expected array got ${typeof value}`);
      err.code = 3;
      throw err;
    }
    if (schema.of) {
      value.forEach((item, i) => {
        for (const [k, subType] of Object.entries(schema.of)) {
          const subSchema = typeof subType === 'string' ? { type: subType } : subType;
          validateSlot(templateId, `${slotPath}[${i}].${k}`, subSchema, item?.[k]);
        }
      });
    }
  } else if (type === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) {
      const err = new Error(`${templateId}:${slotPath} expected object got ${typeof value}`);
      err.code = 3;
      throw err;
    }
  }
}

function validate(templateId, slots, data) {
  for (const [name, schemaRaw] of Object.entries(slots)) {
    const schema = typeof schemaRaw === 'string' ? { type: schemaRaw } : schemaRaw;
    validateSlot(templateId, name, schema, data[name]);
  }
}

function loadAssets(pluginRoot, bundles, extraJs) {
  const css = [];
  const js = [];
  for (const name of bundles || []) {
    const b = ASSET_BUNDLES[name];
    if (!b) continue;
    if (b.css) css.push(readFileSync(join(pluginRoot, b.css), 'utf8'));
    if (b.js) js.push(readFileSync(join(pluginRoot, b.js), 'utf8'));
  }
  if (extraJs) js.push(readFileSync(join(pluginRoot, extraJs), 'utf8'));
  return { css: css.join('\n'), js: js.join('\n') };
}

function escapeForTitle(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function renderReport({ templateId, data, outPath, manifestPath, pluginRoot }) {
  const root = pluginRoot || PLUGIN_ROOT;
  const mPath = manifestPath || join(root, 'templates/manifest.json');
  const manifest = JSON.parse(readFileSync(mPath, 'utf8'));
  const entry = manifest[templateId];
  if (!entry) {
    const ids = Object.keys(manifest).filter((k) => k !== '_meta');
    const err = new Error(`template not found: ${templateId}. valid: ${ids.join(', ')}`);
    err.code = 2;
    throw err;
  }

  validate(templateId, entry.slots, data);

  const tmplRelPath = entry.tmpl || `templates/${templateId}.html.tmpl`;
  const tmpl = readFileSync(join(root, tmplRelPath), 'utf8');
  const body = mustache(tmpl, data);

  const { css, js } = loadAssets(root, entry.asset_bundles, entry.extra_js);
  const title = escapeForTitle(data.title || entry.title || 'Report');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${css}</style>
</head>
<body>
${body}
<script>${js}</script>
</body>
</html>
`;

  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, 'utf8');
    const sidecar = {
      template: templateId,
      rendered_at: new Date().toISOString(),
      render_version: '0.1.0',
      data,
    };
    writeFileSync(outPath + '.data.json', JSON.stringify(sidecar, null, 2), 'utf8');
  } catch (e) {
    const err = new Error(`failed to write ${outPath}: ${e.message}`);
    err.code = 4;
    throw err;
  }

  return outPath;
}

function cli() {
  const { values } = parseArgs({
    options: {
      template: { type: 'string' },
      data: { type: 'string' },
      out: { type: 'string' },
    },
  });
  if (!values.template || !values.data || !values.out) {
    process.stderr.write('usage: render.js --template=<id> --data=<json-path> --out=<html-path>\n');
    process.exit(1);
  }
  try {
    const data = JSON.parse(readFileSync(resolve(values.data), 'utf8'));
    const finalPath = renderReport({
      templateId: values.template,
      data,
      outPath: resolve(values.out),
    });
    process.stdout.write(finalPath + '\n');
  } catch (e) {
    process.stderr.write((e.stack || e.message) + '\n');
    process.exit(e.code ?? 1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) cli();
