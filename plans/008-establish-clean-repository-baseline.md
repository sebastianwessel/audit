# Plan 008: Establish a clean repository baseline before further implementation

> **Executor instructions**: This repository currently has no `HEAD` commit. Follow the classification and verification steps exactly before creating the first commit. Do not stage secrets, evaluator runs, temporary output, or unrelated user files.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: plans/007-evaluation-recovery-and-failure-diagnostics.md
- **Category**: dx
- **Planned at**: unborn `main`, 2026-08-03

## Why this matters

All project files are currently untracked, so there is no immutable baseline for review, drift detection, or a future recovery plan. The intended generated JSON Schema snapshots live in `artifacts/schemas/` and are part of the source contract, while `output/` and `tmp/` contain unrelated generated presentation files and nested dependencies and are not ignored. A blind `git add .` would mix these concerns and make the first commit unreliable.

## Current state

- `.gitignore` deliberately keeps `artifacts/runs/`, `artifacts/reports/`, `artifacts/tmp/`, `.security-review-artifacts/`, and `evaluation/runs/` out of Git, but does not ignore `output/` or root `tmp/`.
- `.agent/IMPLEMENTATION.md:43` defines `artifacts/schemas/` as generated schema snapshots that are checked into the repository and verified by `bun run schema:check`.
- `output/` currently contains presentation output unrelated to Security Reviewer source. It has no product documentation or configuration reference.
- `git log --oneline` fails because `main` has no commits; `git status --short` therefore cannot distinguish intended source from generated material.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Ignore verification | `git check-ignore -v output/eggai-baukasten-point-of-view.pptx` | reports the `output/` rule |
| Schema contract | `bun run schema:check` | exit 0 |
| Full offline verification | `bun run check` | exit 0 |
| Staged-file review | `git diff --cached --name-only` | contains only intentional project source, docs, specs, tests, configs, and schema snapshots |

## Scope

**In scope**

- `.gitignore`
- `plans/README.md`
- `plans/008-establish-clean-repository-baseline.md`
- The first repository commit, after its staged-file review passes

**Out of scope**

- Deleting or modifying any existing `output/` file.
- Rewriting generated schemas, evaluator data, source code, specifications, or documentation.
- Adding `.env`, `.env.*` (except the intentionally tracked `.env.example`), provider credentials, or local evaluator results to Git.

## Steps

### Step 1: Exclude unrelated generated output

Add `output/` and root `tmp/` entries to `.gitignore`, adjacent to the other generated-output rules. Do not add `artifacts/` as a whole: `artifacts/schemas/` is a required source-controlled schema snapshot directory.

**Verify**: `git check-ignore -v output/eggai-baukasten-point-of-view.pptx tmp/baukasten/package.json` reports the new rules, and `git status --short --ignored output tmp` shows both directories as ignored.

### Step 2: Validate the intended baseline before staging

Run `bun run schema:check` and `bun run check`. Review `.gitignore` with `git check-ignore -v .env evaluation/runs/<existing-run>/evaluation-run.json output/eggai-baukasten-point-of-view.pptx`; each must be ignored. Confirm `artifacts/schemas/audit-report-v15.schema.json` is *not* ignored.

**Verify**: both Bun commands exit 0; the three local/generated paths are ignored; the schema snapshot is eligible for staging.

### Step 3: Create a deliberate first commit

Stage only the reviewed project paths. Before committing, inspect `git diff --cached --name-only` and stop if it includes `.env`, `evaluation/runs/`, `output/`, `node_modules/`, `coverage/`, temporary directories, or an unexpected binary. Make one clearly named baseline commit such as `chore: establish security reviewer baseline`.

**Verify**: `git status --short` is clean after the commit; `git log -1 --oneline` shows the baseline; `bun run check` still exits 0 from that commit.

## Test plan

- Confirm `output/` is ignored while the required `artifacts/schemas/` snapshots remain stageable.
- Confirm evaluator-run data and `.env` remain ignored.
- Run the existing full offline verification before and after the baseline commit; this plan changes no runtime behaviour.

## Done criteria

- [ ] No unrelated `output/` material can enter a normal Git staging operation.
- [ ] Generated schema snapshots remain source-controlled and pass `bun run schema:check`.
- [ ] The first commit contains no credentials, local run artifacts, or unexpected binaries.
- [ ] `bun run check` exits 0 at the baseline commit.

## STOP conditions

- `output/` turns out to be an intentional product asset directory with a documented release role.
- A staged path contains a secret, raw model/source content, or evaluator run artifact.
- The verification suite fails before staging; fix or record that failure separately rather than hiding it in the baseline commit.
- The initial commit requires changing source, specs, or generated schemas beyond the ignore rule.

## Maintenance notes

Future runtime artifacts belong under the existing ignored output roots. If a new generated directory is intentionally committed, document why it is source-controlled and add a deterministic verification command; otherwise add a narrow ignore rule rather than broadening an existing source directory.
