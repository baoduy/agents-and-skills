// Hand-rolled mustache subset: {{var}}, {{{raw}}}, {{#section}}…{{/section}}, {{^inverted}}…{{/inverted}}
// Zero runtime dependencies.

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);

function tokenize(template) {
  const tokens = [];
  const re = /\{\{(\{?)([\^#\/]?)\s*([\w.-]+)\s*\}?\}\}/g;
  let lastIndex = 0;
  let m;
  while ((m = re.exec(template)) !== null) {
    if (m.index > lastIndex) tokens.push({ type: 'text', value: template.slice(lastIndex, m.index) });
    const [, triple, sigil, name] = m;
    if (sigil === '#') tokens.push({ type: 'section', name });
    else if (sigil === '^') tokens.push({ type: 'inverted', name });
    else if (sigil === '/') tokens.push({ type: 'close', name });
    else if (triple === '{') tokens.push({ type: 'raw', name });
    else tokens.push({ type: 'var', name });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < template.length) tokens.push({ type: 'text', value: template.slice(lastIndex) });
  return tokens;
}

function parse(tokens, end = null) {
  const nodes = [];
  while (tokens.length) {
    const t = tokens.shift();
    if (t.type === 'close') {
      if (t.name !== end) throw new Error(`Mismatched close tag: expected ${end}, got ${t.name}`);
      return nodes;
    }
    if (t.type === 'section' || t.type === 'inverted') {
      const children = parse(tokens, t.name);
      nodes.push({ ...t, children });
    } else {
      nodes.push(t);
    }
  }
  if (end !== null) throw new Error(`Unclosed section: ${end}`);
  return nodes;
}

function lookup(ctxStack, name) {
  if (name === '.') return ctxStack[ctxStack.length - 1];
  const parts = name.split('.');
  for (let i = ctxStack.length - 1; i >= 0; i--) {
    let cur = ctxStack[i];
    let ok = true;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object' || !(p in cur)) { ok = false; break; }
      cur = cur[p];
    }
    if (ok) return cur;
  }
  return undefined;
}

function emit(nodes, ctxStack) {
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += n.value;
    else if (n.type === 'var') {
      const v = lookup(ctxStack, n.name);
      out += v == null ? '' : escapeHtml(v);
    } else if (n.type === 'raw') {
      const v = lookup(ctxStack, n.name);
      out += v == null ? '' : String(v);
    } else if (n.type === 'section') {
      const v = lookup(ctxStack, n.name);
      if (Array.isArray(v)) {
        for (const item of v) out += emit(n.children, [...ctxStack, item]);
      } else if (v && (typeof v !== 'object' || Object.keys(v).length > 0 || !Array.isArray(v))) {
        out += emit(n.children, [...ctxStack, v]);
      }
    } else if (n.type === 'inverted') {
      const v = lookup(ctxStack, n.name);
      const empty = v == null || v === false || (Array.isArray(v) && v.length === 0);
      if (empty) out += emit(n.children, ctxStack);
    }
  }
  return out;
}

export function render(template, data) {
  const tokens = tokenize(template);
  const tree = parse(tokens);
  return emit(tree, [data]);
}
