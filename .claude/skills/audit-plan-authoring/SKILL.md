---
name: audit-plan-authoring
description: Create or revise Security Reviewer audit plans through the constrained draft and reseal workflow. Use when a human asks to review, extend, narrow, disable, or clarify an existing audit plan without changing the target binding or corrupting the executable artifact.
---

# Audit plan authoring

Use this skill only for a human-requested plan change. Read `AGENTS.md` first, then read the paired `plans/<plan-id>.md` projection to understand the current plan.

## Workflow

1. Confirm the request identifies a sealed plan JSON under the configured output root.
2. Create a new explicit draft path with `bun run start plan-draft --output <output> --plan plans/<plan-id>.json --draft plan-drafts/<review-name>.json`.
3. Change only `vectors` in the draft. Preserve the draft's base-plan fields exactly. Each vector must retain a specific title, rationale, enabled state, scoped globs, one or more risk-positive obligations, and limitations.
4. Do not invent source evidence, findings, priorities, attack steps, or approvals. Use the human request and the existing plan's stated scope; the later audit performs source review.
5. Run `bun run start plan-reseal --output <output> --plan plans/<plan-id>.json --draft plan-drafts/<review-name>.json`.
6. Report the new JSON and Markdown paths. State that the new JSON is the audit input and the Markdown is review-only.

## Boundaries

- Do not edit a sealed `plans/<plan-id>.json` directly.
- Do not create an executable YAML or Markdown plan.
- Do not run `audit`, open a target repository, call a provider, fetch network data, or change target/context paths during plan authoring.
- Stop when the human asks to alter target/context binding, needs a new source inventory, or the plan/draft fails strict validation. Explain that a new `plan` run is required for a new target or context.
- A no-op or destination-exists error is not a reason to overwrite an artifact. Choose a new explicit draft path or make a meaningful requested change.

## Verification

After resealing, verify that the CLI reports a new plan ID and that both `plans/<new-plan-id>.json` and `plans/<new-plan-id>.md` exist. Do not inspect or disclose target source while doing so.

See [the authoring protocol](references/authoring-protocol.md) for the exact editable fields and refusal cases.
