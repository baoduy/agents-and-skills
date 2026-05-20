#!/usr/bin/env bash
# v6 spawn-request brief-format test.
# Validates the shape a team-leader spawn brief MUST have so the main session
# can TaskCreate from it: one block per task, each with the required fields.
set -euo pipefail

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
mkdir -p .team-superpower/spawn-briefs

cat > .team-superpower/spawn-briefs/wave-1.1.md <<'EOF'
## Task impl:1.1.1-add-user-model
wave: 1.1
Files: src/models/user.ts
Depends on: []
task_token_budget: 250000
retrieval_budget: 2
Goal: Define User type with id, email, name fields.
Verification: typecheck passes; `npm test src/models/user.test.ts` green.

## Task impl:1.1.2-add-user-repo
wave: 1.1
Files: src/repos/user-repo.ts
Depends on: [impl:1.1.1-add-user-model]
task_token_budget: 250000
retrieval_budget: 2
Goal: UserRepo with findById, save, delete methods.
Verification: `npm test src/repos/user-repo.test.ts` green.
EOF

pass=0; fail=0
TASKS=$(grep -cE '^## Task impl:' .team-superpower/spawn-briefs/wave-1.1.md)
if [ "$TASKS" = "2" ]; then echo "PASS: 2 tasks parsed"; pass=$((pass+1));
else echo "FAIL: expected 2 tasks, got $TASKS"; fail=$((fail+1)); fi

REQUIRED=("wave:" "Files:" "Depends on:" "Goal:" "Verification:")
for f in "${REQUIRED[@]}"; do
  COUNT=$(grep -cE "^${f}" .team-superpower/spawn-briefs/wave-1.1.md)
  if [ "$COUNT" = "2" ]; then echo "PASS: '${f}' on each task";
    pass=$((pass+1));
  else echo "FAIL: '${f}' count=$COUNT (expected 2)"; fail=$((fail+1)); fi
done

echo "spawn-request.test.sh: $pass passed, $fail failed"
[ "$fail" = "0" ]
