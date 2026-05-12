#!/usr/bin/env bash
# check-deps.sh — probe SVG→PNG renderers for tech-graph plugin.
# Probes in order: cairosvg (python) → rsvg-convert (system) → puppeteer (node).
# Writes the first available choice to skills/tech-graph/.renderer.
# Exits 0 on success, 1 if none found (prints exact install cmd).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RENDERER_FILE="$PLUGIN_DIR/skills/tech-graph/.renderer"

probe_cairosvg() {
  python3 -c "import cairosvg" >/dev/null 2>&1
}

probe_rsvg() {
  command -v rsvg-convert >/dev/null 2>&1
}

probe_puppeteer() {
  node -e "require('puppeteer')" >/dev/null 2>&1
}

if probe_cairosvg; then
  echo "cairosvg" > "$RENDERER_FILE"
  echo "Renderer: cairosvg (python) — selected"
  exit 0
fi

if probe_rsvg; then
  echo "rsvg-convert" > "$RENDERER_FILE"
  echo "Renderer: rsvg-convert — selected"
  exit 0
fi

if probe_puppeteer; then
  echo "puppeteer" > "$RENDERER_FILE"
  echo "Renderer: puppeteer (node) — selected"
  exit 0
fi

cat <<'EOF' >&2
ERROR: No SVG→PNG renderer found on this system.

Install ONE of the following (cairosvg is recommended):

  1) pip install cairosvg            # requires Python >= 3.8
  2) brew install librsvg            # macOS
     apt-get install librsvg2-bin    # Debian/Ubuntu
  3) npm install -g puppeteer        # heavy; last resort

After install, re-run: bash plugins/tech-graph/scripts/check-deps.sh
EOF
exit 1
