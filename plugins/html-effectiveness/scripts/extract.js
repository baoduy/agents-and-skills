#!/usr/bin/env node
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getTmpDir, ROOT } from './_tmp.js';

const UPSTREAM_REPO = 'ThariqS/html-effectiveness';
const API_BASE = 'https://api.github.com';
const RAW_BASE = 'https://raw.githubusercontent.com';

async function ghFetch(url, accept = 'application/vnd.github+json') {
  const headers = { 'Accept': accept, 'User-Agent': 'html-effectiveness-vendor' };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return res;
}

export async function fetchUpstreamFile(filename, ref = 'main') {
  const url = `${RAW_BASE}/${UPSTREAM_REPO}/${ref}/${filename}`;
  const res = await ghFetch(url, 'text/plain');
  return await res.text();
}

export async function fetchUpstreamSha(ref = 'main') {
  const url = `${API_BASE}/repos/${UPSTREAM_REPO}/commits/${ref}`;
  const res = await ghFetch(url);
  const json = await res.json();
  return json.sha;
}

export async function listUpstreamFiles(ref = 'main') {
  const url = `${API_BASE}/repos/${UPSTREAM_REPO}/contents?ref=${ref}`;
  const res = await ghFetch(url);
  const json = await res.json();
  return json.filter((e) => e.type === 'file').map((e) => e.name);
}

export function extractParts(html) {
  const styles = [];
  const scripts = [];
  let body = html;
  body = body.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (_, css) => {
    styles.push(css.trim());
    return '';
  });
  body = body.replace(/<script[^>]*>([\s\S]*?)<\/script>/g, (_, js) => {
    if (js.trim()) scripts.push(js.trim());
    return '';
  });
  body = body
    .replace(/<!doctype[^>]*>/i, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '');
  return { styles, scripts, body: body.trim() };
}

function ensureWorkdir() {
  return getTmpDir('extract');
}

function readFromWorkdir(name) {
  return readFileSync(join(ROOT, 'extract', name), 'utf8');
}

function writeToWorkdir(dir, name, content) {
  writeFileSync(join(dir, name), content);
}

async function cli() {
  const [, , cmd, arg] = process.argv;
  if (cmd === 'fetch') {
    if (!arg) { process.stderr.write('usage: extract.js fetch <file>\n'); process.exit(1); }
    const dir = ensureWorkdir();
    const html = await fetchUpstreamFile(arg);
    writeToWorkdir(dir, arg, html);
    process.stdout.write(`${join(dir, arg)}\n`);
  } else if (cmd === 'sha') {
    process.stdout.write(await fetchUpstreamSha() + '\n');
  } else if (cmd === 'list') {
    const files = await listUpstreamFiles();
    process.stdout.write(files.join('\n') + '\n');
  } else if (cmd === 'split') {
    if (!arg) { process.stderr.write('usage: extract.js split <file>\n'); process.exit(1); }
    const html = readFromWorkdir(arg);
    const { styles, scripts, body } = extractParts(html);
    const base = arg.replace(/\.html$/, '');
    const dir = join(ROOT, 'extract');
    writeToWorkdir(dir, `${base}.body.html`, body + '\n');
    writeToWorkdir(dir, `${base}.styles.css`, styles.join('\n\n/* --- */\n\n') + '\n');
    writeToWorkdir(dir, `${base}.scripts.js`, scripts.join('\n\n/* --- */\n\n') + '\n');
    process.stdout.write(`${dir}/${base}.{body.html,styles.css,scripts.js}\n`);
  } else {
    process.stderr.write('usage: extract.js {fetch <file>|sha|list|split <file>}\n');
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((e) => { process.stderr.write(e.stack + '\n'); process.exit(1); });
}
