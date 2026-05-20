#!/usr/bin/env bash
# v5 phase-end-review test.
# Seeds an arch-map with a SOLID claim and a diff that violates it; verifies
# team-leader's phase-end SOLID scan would detect the violation and emit a
# rework task id.
set -euo pipefail

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
mkdir -p docs/superpowers/specs

cat > docs/superpowers/specs/2026-05-20-fooflow-arch-map.md <<'EOF'
# Arch-map — fooflow
## SOLID
- PaymentProcessor must accept new strategies via DI, not inheritance.
## DRY hotspots
- Reuse src/utils/money.ts for currency math.
EOF

DIFF_FILE="${WORK}/sim-diff.patch"
cat > "$DIFF_FILE" <<'EOF'
+class StripePaymentProcessor extends PaymentProcessor {
+  override charge() { /* ... */ }
+}
EOF

if grep -qE 'extends PaymentProcessor' "$DIFF_FILE"; then
  REWORK_ID="impl:rework-stripe-payment-inheritance-violation"
  echo "Detected SOLID violation. Would TaskCreate ${REWORK_ID}"
  echo "PASS: violation caught"
  exit 0
fi
echo "FAIL: violation not caught"
exit 1
