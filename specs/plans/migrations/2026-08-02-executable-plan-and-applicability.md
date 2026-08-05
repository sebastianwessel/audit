# Executable plan and applicability migration

Status: implemented.

## Decision

Audit owns plan generation and plan execution, not organizational approval workflow. A strict plan is executable when its target and context fingerprints match the current audit input. Human review, editing, extension, approval, ownership, and change-management records remain external.

Every plan-owned review obligation closes as one of: confirmed claim, rejected candidate, no source-backed candidate, review required, incomplete, not reached, or `not-applicable`. `not-applicable` requires a candidate-blind, tool-inspected, source-backed posture assessment and a crisp reason. It is neutral: it is neither a finding nor a passed check. A vector whose every obligation is not applicable has the `not-applicable` outcome; mixed vectors retain the per-obligation closure rows.

## Contract impact

- `AttackPlanSchema` no longer accepts review status or reviewer metadata.
- The `approve` CLI command and approval gate are removed.
- Source posture adds `not-applicable` and its required reason.
- Obligation closure exposes the optional reason and the neutral terminal disposition.
- Vector coverage adds the `not-applicable` outcome and count.

Earlier plan artifacts containing approval fields are rejected rather than converted. Audit report v13 and checkpoint v12 remain current because their contracts already fail closed on unknown fields; regenerated schemas capture the additive applicability fields.

## Verification

- matching-plan execution and fingerprint mismatch tests;
- source-posture reason validation;
- neutral not-applicable closure test;
- generated schema, type, lint, full test, and bounded provider-smoke checks.
