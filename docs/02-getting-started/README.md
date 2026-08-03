# Getting started

## Requirements

- Bun 1.3.14 or newer.
- Authorization to inspect the target repository.
- A provider credential only for a model-backed plan, audit, or provider evaluation.

## Install and configure

```bash
bun install
cp .env.example .env
```

Open `.env`, set `SECURITY_REVIEWER_MODEL`, and set the selected provider’s API key. The file is ignored by Git. Values use this precedence: built-in defaults, inherited environment, `.env`, then explicit command flags.

```bash
bun run check
```

The default checks are local and do not require a provider credential.

## First plan

```bash
bun run start plan --target ./path/to/repository
```

The configured artifact directory is created automatically and receives two matching artifacts: executable `plans/<plan-id>.json` and readable `plans/<plan-id>.md`. Read the Markdown projection in your normal engineering or governance workflow. If the plan needs changes, create a constrained draft and reseal it rather than editing the executable JSON directly:

```bash
bun run start plan-draft \
  --plan plans/<plan-id>.json \
  --draft plan-drafts/review.json

# Edit only the draft's vectors, then publish a new plan pair.
bun run start plan-reseal \
  --plan plans/<plan-id>.json \
  --draft plan-drafts/review.json
```

The new JSON plan has a new identity. Markdown is for review only; JSON is the only format accepted by the audit.

## Audit the plan

Run the saved plan when you are ready:

```bash
bun run start audit --target ./path/to/repository --plan plans/<plan-id>.json
```

Security Reviewer does not store or enforce an approval process. It rejects malformed plans and plans whose target or context fingerprints no longer match, so an edited plan is always tied to the source and context it audits.
