# Claim-first confirmation

Status: implemented

## Decision

Remove category, priority, confidence, impact, and proposed-fix fields from the plan, candidate, verifier, report, lineage, and evaluation finding-match contracts.

The confirmation path now proves only one precise source-backed claim:

1. an approved review obligation;
2. a selected operation and unsafe condition;
3. a verifier that independently reads source; and
4. an explicit challenge of every mapped control and relevant source posture.

Human triage may later decide urgency, ownership, impact, and remediation. It is not part of model admission and cannot make a claim valid.

## Rationale

The prototype-pollution evaluation showed the prior workflow could identify the broad concern while failing to ground the expected source condition and while retaining the same concern after a patch introduced relevant controls. Canonical grounding was also required to author a full report item before verification. That overloaded the only safety-critical decision boundary.

## Breaking contract changes

- Attack vectors retain title, rationale, scope, obligations, and limitations; category and priority are removed.
- Grounded candidates and persisted findings contain `statement`, source evidence, obligations, and limitations only.
- Audit report is schema v13; terminal vector checkpoint is v12; canonical grounding draft is v3; lineage is v2.
- Corpus answer keys are schema v5. Expected findings match through operation/unsafe-condition ranges only. Planning scenarios bind explicit expected-finding ids and paths. Generated-plan evaluation reports scope coverage, not automatic semantic-plan quality.
- No compatibility adapters or migration readers exist. Older artifacts fail closed.

## Verification

- Zod contract tests reject retired fields.
- Candidate-grounding prompt tests prove report presentation fields are absent before verification.
- Scorer tests prove a category or priority cannot affect expected-finding detection.
- Full schema, type, lint, unit, fixture-evaluation, corpus-evaluation, and repository checks pass before handoff.
