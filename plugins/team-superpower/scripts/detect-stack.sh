#!/usr/bin/env bash
# detect-stack.sh — best-effort filesystem detection for the team-superpower
# stack block. Emits a YAML block (the same shape that lives inside the
# ```team-superpower``` fence in CLAUDE.md) to stdout, plus exit codes:
#
#   0  confident detection (single BE candidate and/or single FE candidate)
#   1  no stack signals found (BE absent AND FE absent) — lead should escalate
#   2  ambiguous (multiple plausible BE languages, or BE/FE conflict that the
#      owner must resolve) — lead writes stack.detected.md with both options
#
# Usage:
#   bash detect-stack.sh [<repo-root>]
#
# Dependencies: bash, find, grep, sed. jq is preferred but not required (we
# parse package.json with grep fallbacks when jq is missing).
#
# What this script does NOT do:
#   - Write to CLAUDE.md. The spec forbids it. Output goes to stdout; the lead
#     decides whether to write it to docs/superpowers/stack.detected.md.
#   - Guess test commands when there is no signal — fields left blank with a
#     `# CONFIRM:` comment for the owner to fill in.

set -euo pipefail

ROOT="${1:-$PWD}"
cd "$ROOT"

# ---- helpers --------------------------------------------------------------

has_file_glob() {
  # has_file_glob <maxdepth> <name>
  find . -maxdepth "$1" -type f -name "$2" 2>/dev/null | head -n1 | grep -q .
}

has_file_deep() {
  # has_file_deep <name>
  find . -type f -name "$1" -not -path './node_modules/*' -not -path './.git/*' -not -path './dist/*' -not -path './build/*' 2>/dev/null | head -n1 | grep -q .
}

read_pkg_field() {
  # read_pkg_field <jq-expr> [default]
  local expr="$1" default="${2:-}"
  [ -f package.json ] || { printf '%s' "$default"; return; }
  if command -v jq >/dev/null 2>&1; then
    local v
    v="$(jq -r "$expr // empty" package.json 2>/dev/null || true)"
    printf '%s' "${v:-$default}"
  else
    printf '%s' "$default"
  fi
}

pkg_has_dep() {
  # pkg_has_dep <name>
  [ -f package.json ] || return 1
  if command -v jq >/dev/null 2>&1; then
    jq -e --arg n "$1" '((.dependencies // {}) + (.devDependencies // {}) + (.peerDependencies // {})) | has($n)' package.json >/dev/null 2>&1
  else
    grep -qE "\"$1\"[[:space:]]*:" package.json
  fi
}

pkg_script() {
  # pkg_script <script-name> -> command string (empty if missing)
  [ -f package.json ] || return 0
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg n "$1" '.scripts[$n] // empty' package.json 2>/dev/null || true
  fi
}

# ---- backend detection ----------------------------------------------------

backend_language=""
backend_framework=""
backend_test_framework=""
backend_build_command=""
backend_test_command=""
backend_format_command=""
backend_migration_tool=""
backend_package_manager=""
backend_candidates=()

if has_file_glob 3 '*.csproj' || has_file_glob 2 '*.sln' || [ -f Directory.Build.props ]; then
  backend_candidates+=("csharp")
fi
if [ -f pyproject.toml ] || [ -f setup.py ] || [ -f requirements.txt ] || [ -f Pipfile ]; then
  backend_candidates+=("python")
fi
if [ -f go.mod ]; then
  backend_candidates+=("go")
fi
if [ -f Cargo.toml ]; then
  backend_candidates+=("rust")
fi
if [ -f pom.xml ] || [ -f build.gradle ] || [ -f build.gradle.kts ]; then
  backend_candidates+=("java")
fi
# Node-ts as backend only when package.json exists, "type": "module", and no
# frontend signal in deps. We resolve this after FE detection.

if [ ${#backend_candidates[@]} -eq 1 ]; then
  backend_language="${backend_candidates[0]}"
fi

# Per-language fillers
case "$backend_language" in
  csharp)
    backend_framework="aspnetcore"
    backend_build_command="dotnet build"
    backend_test_command="dotnet test"
    backend_format_command="dotnet format --verify-no-changes"
    backend_package_manager="nuget"
    # Test framework: scan csproj for hints
    if find . -maxdepth 4 -type f -name '*.csproj' -exec grep -l -iE 'xunit' {} \; 2>/dev/null | head -n1 | grep -q .; then
      backend_test_framework="xunit"
    elif find . -maxdepth 4 -type f -name '*.csproj' -exec grep -l -iE 'nunit' {} \; 2>/dev/null | head -n1 | grep -q .; then
      backend_test_framework="nunit"
    elif find . -maxdepth 4 -type f -name '*.csproj' -exec grep -l -iE 'mstest' {} \; 2>/dev/null | head -n1 | grep -q .; then
      backend_test_framework="mstest"
    elif find . -maxdepth 4 -type f -name '*.csproj' -exec grep -l -iE 'reqnroll|specflow' {} \; 2>/dev/null | head -n1 | grep -q .; then
      backend_test_framework="reqnroll"
    else
      backend_test_framework="# CONFIRM: xunit | nunit | mstest | reqnroll"
    fi
    # Migration tool: EF Core hint
    if find . -maxdepth 4 -type f -name '*.csproj' -exec grep -l -iE 'Microsoft\.EntityFrameworkCore' {} \; 2>/dev/null | head -n1 | grep -q .; then
      backend_migration_tool="ef-core"
    else
      backend_migration_tool="none"
    fi
    ;;
  python)
    backend_framework="# CONFIRM: fastapi | django | flask | starlette | none"
    if [ -f pyproject.toml ] && grep -qE '\[tool\.poetry\]' pyproject.toml; then
      backend_package_manager="poetry"
      backend_build_command="poetry build"
      backend_test_command="poetry run pytest"
    elif [ -f Pipfile ]; then
      backend_package_manager="pipenv"
      backend_build_command="# CONFIRM: build command"
      backend_test_command="pipenv run pytest"
    else
      backend_package_manager="pip"
      backend_build_command="# CONFIRM: build command (often none for python apps)"
      backend_test_command="pytest"
    fi
    backend_test_framework="pytest"
    backend_format_command="# CONFIRM: ruff format --check . | black --check . | none"
    if grep -qiE 'alembic' pyproject.toml requirements.txt Pipfile 2>/dev/null; then
      backend_migration_tool="alembic"
    elif grep -qiE 'django' pyproject.toml requirements.txt Pipfile 2>/dev/null; then
      backend_migration_tool="django-migrations"
    else
      backend_migration_tool="none"
    fi
    ;;
  go)
    backend_framework="# CONFIRM: stdlib | gin | echo | chi | fiber"
    backend_build_command="go build ./..."
    backend_test_command="go test ./..."
    backend_format_command="gofmt -l ."
    backend_test_framework="go-testing"
    backend_package_manager="go-modules"
    backend_migration_tool="# CONFIRM: golang-migrate | goose | none"
    ;;
  rust)
    backend_framework="# CONFIRM: axum | actix | rocket | warp"
    backend_build_command="cargo build"
    backend_test_command="cargo test"
    backend_format_command="cargo fmt -- --check"
    backend_test_framework="cargo-test"
    backend_package_manager="cargo"
    backend_migration_tool="# CONFIRM: sqlx-migrate | refinery | none"
    ;;
  java)
    backend_framework="# CONFIRM: spring-boot | quarkus | micronaut | none"
    if [ -f pom.xml ]; then
      backend_build_command="mvn -B compile"
      backend_test_command="mvn -B test"
      backend_format_command="# CONFIRM: mvn spotless:check | none"
      backend_package_manager="maven"
    else
      backend_build_command="./gradlew build"
      backend_test_command="./gradlew test"
      backend_format_command="# CONFIRM: ./gradlew spotlessCheck | none"
      backend_package_manager="gradle"
    fi
    backend_test_framework="junit"
    backend_migration_tool="# CONFIRM: flyway | liquibase | none"
    ;;
esac

# ---- frontend detection ---------------------------------------------------

frontend_language=""
frontend_framework=""
frontend_bundler=""
frontend_test_framework=""
frontend_e2e_framework=""
frontend_ui_library=""
frontend_package_manager=""
frontend_build_command=""
frontend_test_command=""
have_pkg=0
[ -f package.json ] && have_pkg=1

if [ "$have_pkg" -eq 1 ]; then
  # Detect framework
  if pkg_has_dep next; then frontend_framework="next"; frontend_bundler="next";
  elif pkg_has_dep nuxt; then frontend_framework="nuxt"; frontend_bundler="nuxt";
  elif pkg_has_dep react || pkg_has_dep react-dom; then frontend_framework="react";
  elif pkg_has_dep vue; then frontend_framework="vue";
  elif pkg_has_dep svelte; then frontend_framework="svelte";
  elif pkg_has_dep solid-js; then frontend_framework="solid";
  elif pkg_has_dep '@angular/core'; then frontend_framework="angular";
  fi

  if [ -z "$frontend_bundler" ]; then
    if has_file_glob 2 'vite.config.*'; then frontend_bundler="vite";
    elif has_file_glob 2 'webpack.config.*'; then frontend_bundler="webpack";
    elif has_file_glob 2 'rspack.config.*'; then frontend_bundler="rspack";
    elif has_file_glob 2 'rollup.config.*'; then frontend_bundler="rollup";
    elif has_file_glob 2 'next.config.*'; then frontend_bundler="next";
    elif has_file_glob 2 'nuxt.config.*'; then frontend_bundler="nuxt";
    fi
  fi

  if [ -n "$frontend_framework" ] || [ -n "$frontend_bundler" ]; then
    # Confirmed FE shape
    frontend_language="typescript"
    [ -f tsconfig.json ] || frontend_language="javascript"

    if pkg_has_dep vitest; then frontend_test_framework="vitest";
    elif pkg_has_dep jest; then frontend_test_framework="jest";
    elif pkg_has_dep '@playwright/test'; then frontend_test_framework="none";
    else frontend_test_framework="# CONFIRM: vitest | jest | none";
    fi

    if pkg_has_dep '@playwright/test'; then frontend_e2e_framework="playwright";
    elif pkg_has_dep cypress; then frontend_e2e_framework="cypress";
    else frontend_e2e_framework="none";
    fi

    if pkg_has_dep '@shadcn/ui' || [ -d components/ui ] && grep -RIl 'shadcn' components/ui 2>/dev/null | head -n1 | grep -q . ; then
      frontend_ui_library="shadcn"
    elif pkg_has_dep '@mui/material'; then frontend_ui_library="mui";
    elif pkg_has_dep antd; then frontend_ui_library="antd";
    elif pkg_has_dep tailwindcss; then frontend_ui_library="tailwind-only";
    else frontend_ui_library="# CONFIRM: shadcn | mui | antd | tailwind-only | none";
    fi

    # Package manager: lockfile is the source of truth
    if [ -f pnpm-lock.yaml ]; then frontend_package_manager="pnpm";
    elif [ -f yarn.lock ]; then frontend_package_manager="yarn";
    elif [ -f bun.lockb ] || [ -f bun.lock ]; then frontend_package_manager="bun";
    else frontend_package_manager="npm";
    fi

    # Scripts → commands
    local_build="$(pkg_script build)"
    local_test="$(pkg_script test)"
    if [ -n "$local_build" ]; then
      frontend_build_command="$frontend_package_manager build"
    fi
    if [ -n "$local_test" ]; then
      frontend_test_command="$frontend_package_manager test"
    fi
  fi
fi

# Resolve node-ts-as-backend: package.json without any FE framework and with a
# server framework dep counts as a BE candidate.
if [ "$have_pkg" -eq 1 ] && [ -z "$frontend_framework" ] && [ -z "$frontend_bundler" ]; then
  if pkg_has_dep express || pkg_has_dep fastify || pkg_has_dep koa || pkg_has_dep '@nestjs/core' || pkg_has_dep hono; then
    backend_candidates+=("node-ts")
    # If this was our only BE candidate, set it
    if [ -z "$backend_language" ] && [ ${#backend_candidates[@]} -eq 1 ]; then
      backend_language="node-ts"
    fi
  fi
fi

# Fill node-ts BE
if [ "$backend_language" = "node-ts" ]; then
  if pkg_has_dep '@nestjs/core'; then backend_framework="nestjs";
  elif pkg_has_dep fastify; then backend_framework="fastify";
  elif pkg_has_dep express; then backend_framework="express";
  elif pkg_has_dep koa; then backend_framework="koa";
  elif pkg_has_dep hono; then backend_framework="hono";
  fi
  if pkg_has_dep vitest; then backend_test_framework="vitest";
  elif pkg_has_dep jest; then backend_test_framework="jest";
  else backend_test_framework="# CONFIRM: vitest | jest | mocha";
  fi
  if [ -f pnpm-lock.yaml ]; then backend_package_manager="pnpm";
  elif [ -f yarn.lock ]; then backend_package_manager="yarn";
  elif [ -f bun.lockb ] || [ -f bun.lock ]; then backend_package_manager="bun";
  else backend_package_manager="npm";
  fi
  backend_build_command="$backend_package_manager build"
  backend_test_command="$backend_package_manager test"
  backend_format_command="# CONFIRM: prettier --check . | eslint . | none"
  backend_migration_tool="# CONFIRM: prisma | typeorm | knex | none"
fi

# ---- contracts ------------------------------------------------------------

contracts_sot=""
contracts_openapi_path=""
contracts_ts_gen_command=""

if find . -maxdepth 5 -type f \( -name 'openapi.yaml' -o -name 'openapi.json' -o -name 'swagger.yaml' -o -name 'swagger.json' \) -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | head -n1 | grep -q .; then
  contracts_sot="openapi"
  contracts_openapi_path="$(find . -maxdepth 5 -type f \( -name 'openapi.yaml' -o -name 'openapi.json' -o -name 'swagger.yaml' \) -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | head -n1 | sed 's|^\./||')"
  contracts_ts_gen_command="# CONFIRM: command that regenerates TS types from $contracts_openapi_path"
elif find . -maxdepth 5 -type f -name '*.proto' -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | head -n1 | grep -q .; then
  contracts_sot="grpc"
elif find . -maxdepth 5 -type f -name 'schema.graphql' -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | head -n1 | grep -q .; then
  contracts_sot="graphql"
elif [ -n "$backend_language" ] && [ -n "$frontend_framework" ]; then
  contracts_sot="# CONFIRM: openapi | grpc | graphql | typescript | none"
else
  contracts_sot="none"
fi

# ---- CI -------------------------------------------------------------------

ci_provider=""
ci_workflow_path=""

if find .github/workflows -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null | head -n1 | grep -q .; then
  ci_provider="github-actions"
  ci_workflow_path="$(find .github/workflows -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null | head -n1)"
elif [ -f azure-pipelines.yml ] || [ -f .azure/pipelines.yml ]; then
  ci_provider="azure-pipelines"
  [ -f azure-pipelines.yml ] && ci_workflow_path="azure-pipelines.yml" || ci_workflow_path=".azure/pipelines.yml"
elif [ -f .gitlab-ci.yml ]; then
  ci_provider="gitlab-ci"
  ci_workflow_path=".gitlab-ci.yml"
elif [ -f .circleci/config.yml ]; then
  ci_provider="circleci"
  ci_workflow_path=".circleci/config.yml"
else
  ci_provider="none"
fi

# ---- emit -----------------------------------------------------------------

if [ -z "$backend_language" ] && [ -z "$frontend_framework" ] && [ -z "$frontend_bundler" ]; then
  echo "# detect-stack: no BE or FE signal found in $ROOT" >&2
  exit 1
fi

emit_backend=0
emit_frontend=0
[ -n "$backend_language" ] && emit_backend=1
{ [ -n "$frontend_framework" ] || [ -n "$frontend_bundler" ]; } && emit_frontend=1

cat <<EOF
# Auto-generated by team-superpower detect-stack.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ).
# Review every \`# CONFIRM:\` line, then paste into your CLAUDE.md inside a
# \`\`\`team-superpower fenced block. The plugin will NOT overwrite your CLAUDE.md.
EOF

if [ "$emit_backend" -eq 1 ]; then
  cat <<EOF
backend:
  language: ${backend_language}
  framework: ${backend_framework:-# CONFIRM: framework}
  test_framework: ${backend_test_framework:-# CONFIRM: test framework}
  build_command: ${backend_build_command:-# CONFIRM: build command}
  test_command: ${backend_test_command:-# CONFIRM: test command}
  format_command: ${backend_format_command:-# CONFIRM: format check command (or 'none')}
  migration_tool: ${backend_migration_tool:-none}
  package_manager: ${backend_package_manager:-# CONFIRM: package manager}
EOF
else
  echo "backend: none"
fi

if [ "$emit_frontend" -eq 1 ]; then
  cat <<EOF
frontend:
  language: ${frontend_language:-typescript}
  framework: ${frontend_framework:-# CONFIRM: framework}
  bundler: ${frontend_bundler:-# CONFIRM: bundler}
  test_framework: ${frontend_test_framework:-none}
  e2e_framework: ${frontend_e2e_framework:-none}
  ui_library: ${frontend_ui_library:-none}
  package_manager: ${frontend_package_manager:-npm}
  build_command: ${frontend_build_command:-# CONFIRM: build command}
  test_command: ${frontend_test_command:-# CONFIRM: test command}
EOF
else
  echo "frontend: none"
fi

cat <<EOF
contracts:
  source_of_truth: ${contracts_sot}
EOF
if [ -n "$contracts_openapi_path" ]; then
  echo "  openapi_path: $contracts_openapi_path"
fi
if [ -n "$contracts_ts_gen_command" ]; then
  echo "  ts_gen_command: \"$contracts_ts_gen_command\""
fi

cat <<EOF
ci:
  provider: ${ci_provider}
EOF
if [ -n "$ci_workflow_path" ]; then
  echo "  workflow_path: $ci_workflow_path"
fi
cat <<EOF
  required_checks: []     # CONFIRM: e.g. ["build", "test", "lint"]
  poll_timeout_minutes: 20
security:
  domain: # CONFIRM: payments | healthcare | generic | internal-only
  pii: # CONFIRM: yes | no
  public_endpoints: # CONFIRM: yes | no
  data_at_rest: # CONFIRM: sql | nosql | none
EOF

# Exit with ambiguity warning when there are >1 BE candidates the script could
# not narrow down.
if [ ${#backend_candidates[@]} -gt 1 ]; then
  uniq_list="$(printf '%s\n' "${backend_candidates[@]}" | sort -u | tr '\n' ',' | sed 's/,$//')"
  echo "# AMBIGUOUS_BACKEND: multiple BE candidates found: $uniq_list — owner must confirm" >&2
  exit 2
fi

exit 0
