#!/usr/bin/env bash
set -euo pipefail

workflow="/home/runner/work/agents-and-skills/agents-and-skills/.github/workflows/npm-publish.yaml"

python3 - <<'PY' "$workflow"
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text()

publish = re.search(
    r"- name: Publish to npm\n"
    r"(?P<body>(?:        .*\n)+)",
    text,
)
assert publish, "Publish to npm step not found"

body = publish.group("body")
assert "if: steps.flag.outputs.enable == 'true'" in body, "Publish step must honor release flag"
assert "NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}" in body, "Publish step must use secrets.NPM_TOKEN"

release_idx = text.index("- name: Create GitHub Release")
publish_idx = text.index("- name: Publish to npm")
assert publish_idx < release_idx, "npm publish should happen before creating a GitHub release"
PY
