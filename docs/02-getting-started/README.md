# Getting started

## Requirements

- Bun 1.3.14 or newer. You can run a published release with `bunx @sebastianwessel/audit --help`, or clone the repository for development.
- Authorization to inspect the target repository.
- A provider credential only for a model-backed plan, audit, or provider evaluation.

## Install and configure

```bash
bun install
cp .env.example .env
```

Open `.env` and set `OPENAI_API_KEY`. The default route is OpenAI / gpt-5.6-terra, so no other setting is needed for normal use. The file is ignored by Git. Values use this precedence: built-in defaults, inherited environment, then `.env`. Command arguments select an operation but never override runtime configuration. Uncomment `AUDIT_PROVIDER`, `AUDIT_MODEL`, and the matching credential setting only when selecting another route.

```bash
bun run check
```

The default checks are local and do not require a provider credential.

## First plan

```bash
bun run start plan --target ./path/to/repository --work .audit-work
```

Private work is created automatically and receives two matching plan artifacts: executable `plans/<plan-id>.json` and readable `plans/<plan-id>.md`. Keep private work local: it also contains snapshots and resumable checkpoints. Read the Markdown projection in your normal engineering or governance workflow. If the plan needs changes, create a constrained draft and reseal it rather than editing the executable JSON directly:

```bash
bun run start plan-draft \
  --work .audit-work \
  --plan plans/<plan-id>.json \
  --draft plan-drafts/review.json

# Edit only the draft's vectors, then publish a new plan pair.
bun run start plan-reseal \
  --work .audit-work \
  --plan plans/<plan-id>.json \
  --draft plan-drafts/review.json
```

The new JSON plan has a new identity. Markdown is for review only; JSON is the only format accepted by the audit.

## Audit the plan

Run the saved plan when you are ready:

```bash
bun run start audit \
  --target ./path/to/repository \
  --work .audit-work \
  --public-output .audit-artifacts \
  --plan plans/<plan-id>.json \
  --run-id first-audit
```

Audit does not store or enforce an approval process. It rejects malformed plans and plans whose target or context fingerprints no longer match, so an edited plan is always tied to the source and context it audits. The audit writes source-minimal reports to `.audit-artifacts`; this is the only root intended for CI upload. Keep the run id if you need to resume: repeat the command with `--run-id first-audit --resume true --retry-unfinished true` after a stopped audit.
