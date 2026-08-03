# Posture-provenance projection

Status: implementation refactor authorized by the product owner. This change removes a duplicated model-output duty that provider diagnostics identified as a repeated structural source of false negatives. It does not add a detector, language rule, benchmark condition, answer-key signal, or alternate model route.

## Decision

Discovery and grounding models must not author `sourcePostureAssessmentIds`. Those identifiers, and the evidence-map fact references required by the corresponding validated posture assessments, are deterministically projected from the exact approved plan obligations after model output validation.

The projection is owned once by `audit-execution/source-posture/provenance`. It selects all and only assessments whose `evidenceQuestionIndex` is referenced by the seed or closure obligations, unions their pre-existing map fact identifiers with the model-selected map references, and stores canonical sorted unique identifiers. It does not inspect source text, interpret a posture conclusion, infer a vulnerability, alter an obligation, create evidence, or decide admission.

## Consequences

- The discovery model output contains only seed identity, vector identity, hypothesis, approved obligations, selected map facts, and limitations; closure output similarly omits posture identifiers.
- The grounding model preserves seed vector/obligation/map identity and selects map-evidence locations, but does not emit posture identifiers. Canonical materialization carries the seed-owned projection forward.
- Persisted seeds, closures, candidates, verifier requests, reports, checkpoints, and source-posture validation retain canonical non-empty posture bindings. Existing downstream provenance checks remain in force.
- A missing validated posture for a referenced question remains an explicit structural rejection/incomplete outcome; no fallback or inferred posture is permitted.
- The policy is language-neutral and applies to every vector, source extension, corpus item, and provider route.

## Verification

1. Contract tests reject model-authored posture identifiers at discovery and grounding boundaries.
2. Seed, closure, and grounding tests prove canonical provenance is projected exactly once from obligations and validated posture.
3. A regression fixture mirrors the former model-output mismatch and verifies that valid map/obligation output is no longer rejected solely for duplicated posture-ID formatting.
4. Full schema, type, lint, unit, integration, and deterministic evaluation checks pass before an opt-in provider remeasurement.
