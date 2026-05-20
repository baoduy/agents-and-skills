#!/usr/bin/env bash
# v5 owner-touchpoint-count test.
# Validates touchpoint counts per mode by parsing a synthetic transcript.
# Solo=1, single-agent=1, team=2 (the finish-branch touchpoint is the third in
# team mode but lives in phase H, not in the synthetic phase-A transcript).
set -euo pipefail

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/solo.txt" <<'EOF'
[orch] mode=solo
[orch] OWNER_PROMPT: Combined briefing — diff preview + verification
[owner] approve
[orch] apply + commit + push
EOF

cat > "$WORK/single.txt" <<'EOF'
[orch] mode=single-agent
[orch] OWNER_PROMPT: Combined spec + plan
[owner] approve
[orch] spawn impl
[impl] commit
[orch] spawn qc
[qc] QC_PASS
EOF

cat > "$WORK/team.txt" <<'EOF'
[orch] mode=team
[arch] OWNER_PROMPT: Spec sign-off
[owner] approve
[arch] arch-map written
[planner] OWNER_PROMPT: Plan approval
[owner] approve
[arch] HANDOVER_READY
EOF

count_prompts() { grep -c '^\[.*\] OWNER_PROMPT:' "$1" || true; }

pass=0; fail=0
for mode in solo single team; do
  case $mode in solo|single) expect=1;; team) expect=2;; esac
  n=$(count_prompts "$WORK/${mode}.txt")
  if [ "$n" = "$expect" ]; then echo "PASS: $mode touchpoints=$n (expected $expect)"; pass=$((pass+1));
  else echo "FAIL: $mode touchpoints=$n (expected $expect)"; fail=$((fail+1)); fi
done
echo "touchpoint-count.test.sh: $pass passed, $fail failed"
[ "$fail" = "0" ]
