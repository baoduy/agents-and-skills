#!/usr/bin/env bash
# v5 resume-detect smoke test.
# Mirrors the orchestrator's auto-resume scan: a handover without a
# matching qc-report signals an in-flight feature to resume.
set -euo pipefail

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

mkdir -p docs/superpowers/handovers docs/superpowers/reviews docs/superpowers/plans

cat > docs/superpowers/handovers/2026-05-15-fooflow-handover.md <<'EOF'
# Handover — fooflow
- spec: docs/superpowers/specs/2026-05-15-fooflow-spec.md
- plan: docs/superpowers/plans/2026-05-15-fooflow.md
EOF
touch docs/superpowers/plans/2026-05-15-fooflow.md

slug=""
for h in docs/superpowers/handovers/*-handover.md; do
  [ -e "$h" ] || continue
  candidate=$(basename "$h" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-(.*)-handover.md$/\1/')
  if ! compgen -G "docs/superpowers/reviews/*-${candidate}-qc-report.md" >/dev/null; then
    slug="$candidate"
    break
  fi
done

if [ "$slug" = "fooflow" ]; then
  echo "PASS: detected in-progress slug fooflow"
  exit 0
fi
echo "FAIL: expected fooflow, got '$slug'"
exit 1
