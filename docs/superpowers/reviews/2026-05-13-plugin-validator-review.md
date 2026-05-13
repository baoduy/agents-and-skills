# Code Review: plugin-validator (phase 5)

**Date:** 2026-05-13
**Reviewer:** Reviewer agent (Sonnet 4.6)
**Commit under review:** `9fd5e1088dec4bc4766693382b060084fa33a5cf`
**Branch:** `superpower-plugin-validator`
**Design doc:** `docs/superpowers/specs/2026-05-13-plugin-validator-design.md`
**Plan:** `docs/superpowers/plans/2026-05-13-plugin-validator-plan.md`
**Skill invoked:** `superpowers:requesting-code-review`

---

## Verdict

PASS

---

## Findings

### Minor

- `docs/superpowers/plans/2026-05-13-plugin-validator-plan.md:513-580`: 🟡 minor: Task 8 checkboxes (Steps 1–5, lines 513, 532, 546, 563, 572) remain `- [ ]` in the committed plan file. The commit itself is correct and complete — Task 8 was executed successfully — but the implementer did not tick the five Task 8 boxes before committing, leaving the plan file with 5 unchecked items. Fix: the implementer or lead can tick these boxes in a follow-up commit to the plan file, or accept as cosmetic given the commit is already atomic and verified.

---

## Verification Trail

### Check 1: Atomic commit stat (expected 11 changed paths)

```
$ git show --stat 9fd5e10
 .claude-plugin/marketplace.json                       |  8 +++
 README.md                                             |  1 +
 docs/superpowers/plans/2026-05-13-plugin-validator-plan.md | 60 ++++---
 plugins/plugin-validator/.claude-plugin/plugin.json   |  8 +++
 plugins/plugin-validator/README.md                    | 37 +++++++++++++
 plugins/plugin-validator/agents/plugin-validator.md   |  0  (rename)
 plugins/plugin-validator/commands/validate-plugins.md |  0  (rename)
 plugins/plugin-validator/skills/validate-agents/SKILL.md   |  0  (rename)
 plugins/plugin-validator/skills/validate-commands/SKILL.md |  0  (rename)
 plugins/plugin-validator/skills/validate-hooks/SKILL.md    |  0  (rename)
 plugins/plugin-validator/skills/validate-skills/SKILL.md   |  0  (rename)
 11 files changed, 84 insertions(+), 30 deletions(-)
```

Result: 11 paths. PASS. (The 11th is the plan file checkbox update — acceptable per review brief.)

### Check 2: Rename history preserved

```
$ git log --follow --oneline plugins/plugin-validator/skills/validate-skills/SKILL.md
9fd5e10 feat(plugin-validator): package validate-* skills, agent, and command...
1e6875b fix(plugins): drop agents/commands arrays rejected by loader
8465969 up
```

Result: Pre-rename history surfaces. PASS.

### Check 3: Manifest compliance — no forbidden keys in plugin.json

```
$ python3 -c "
import json
d = json.load(open('plugins/plugin-validator/.claude-plugin/plugin.json'))
forbidden = {'skills', 'agents', 'commands', 'hooks'}
found = forbidden & set(d.keys())
assert not found, f'FORBIDDEN KEYS PRESENT: {found}'
print('No forbidden keys — OK')
print('Keys present:', list(d.keys()))
"
No forbidden keys — OK
Keys present: ['name', 'displayName', 'version', 'description', 'author', 'keywords']
```

Result: PASS.

### Check 4: Callstack attribution byte-identical

```
$ git show 1e6875b:.claude/skills/validate-skills/SKILL.md > /tmp/orig_full.txt
$ diff /tmp/orig_full.txt plugins/plugin-validator/skills/validate-skills/SKILL.md
[no output]
FILES IDENTICAL
```

Frontmatter lines confirmed present and in original order:
- `license: MIT` (line 4)
- `metadata:` (line 5)
- `  author: Callstack` (line 6)
- `  upstream: https://github.com/callstackincubator/agent-skills` (line 7)

Result: PASS.

### Check 5: Discovery scopes unchanged

All four SKILL.md bodies checked for scope-related sentences:

- `validate-skills/SKILL.md:42–46`: "Find all skill directories under `plugins/`" + "(Per project memory: scope is `plugins/**` only — skip `.claude/skills/`.)" — unchanged.
- `validate-agents/SKILL.md:12`: "Scope: `plugins/**` only." — unchanged.
- `validate-commands/SKILL.md:12`: "Scope: `plugins/**` only." — unchanged.
- `validate-hooks/SKILL.md:12`: "Scope: `plugins/**` only — local-only `.claude/skills/` and `.claude/hooks/` are out of scope." — unchanged.

Result: PASS. No discovery scope edits were made during the move.

### Check 6: Marketplace / README alignment

```
$ grep "plugin-validator" .claude-plugin/marketplace.json
  "name": "plugin-validator",
  "source": "./plugins/plugin-validator",
  ...

$ grep "plugin-validator" README.md
| [`plugin-validator`](plugins/plugin-validator) | Orchestrated validator that c...
```

marketplace.json has 4 plugins entries; `plugin-validator` is the fourth. README.md Plugins table has the new row linking to `plugins/plugin-validator`. Both reference the same path. Result: PASS.

### Check 7: JSON baseline

```
$ python3 -c "import json, glob; [json.load(open(p)) for p in ['.claude-plugin/marketplace.json', *glob.glob('plugins/*/.claude-plugin/plugin.json')]]; print('OK')"
OK
```

Result: PASS.

### Check 8: Self-validation false-positive check

Searched all four validate-* SKILL.md bodies for mentions of `displayName`, `display_name`, or `Display` — zero matches. The validate-skills skill checks only the `name` and `description` frontmatter fields against the agentskills.io spec; it does not flag unknown keys in `plugin.json` as errors. The `displayName` field in `plugins/plugin-validator/.claude-plugin/plugin.json` will not cause a false-positive failure when validate-skills or validate-agents scans `plugins/plugin-validator/`.

Result: PASS.

### Check 9: Out-of-scope guards

```
# gitnexus untouched
$ ls .claude/skills/gitnexus/
gitnexus-cli/  gitnexus-debugging/  gitnexus-exploring/  gitnexus-guide/
gitnexus-impact-analysis/  gitnexus-refactoring/
# (directory and all contents present — not touched by commit)

$ git show 9fd5e10 -- .claude/skills/gitnexus/
[no output — no changes to gitnexus in this commit]

# No top-level agents/commands/skills dirs
$ ls -d agents/ commands/ skills/ 2>/dev/null
No top-level agents/commands/skills dirs
```

Result: PASS. gitnexus was not touched; no content appeared outside `plugins/`.

### Check 10: Plan-file checkbox state

Tasks 1–7 (30 checkboxes): all `- [x]`. PASS.
Task 8 (5 checkboxes, lines 513, 532, 546, 563, 572): all `- [ ]`. The commit was made and is correct, but these boxes were not ticked before committing. Logged as 🟡 minor finding above.

---

## Recommendations

None beyond the minor checkbox note. The implementation is clean: single atomic commit, all six source files removed from `.claude/` and present at their `plugins/plugin-validator/` destinations, manifests updated, no feature logic altered, no forbidden keys, attribution preserved byte-for-byte.
