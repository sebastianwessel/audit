# Evidence-map provenance projection repair

Status: implementation authorized by the product owner after two five-repeat, same-route provider evaluations on 2026-08-01. Both `generated-plan` and `reviewed-plan` produced completed tool-inspected evidence-mapping stages but zero retained facts and zero represented obligations for every terminally incomplete vector. The reviewed-plan result isolates the defect from planning.

## Decision

The evidence-map model contract no longer asks a model to reproduce source snippets, evidence kinds, evidence roles, or end lines. It supplies only the strict fact identifier, closed neutral role, bounded statement, approved-obligation references, and exact `{path,startLine}` selections from the scoped read-only tools. The existing deterministic evidence-map verifier validates those selections and alone projects the persisted redacted snippet, source/configuration kind, and one-line range.

This is a contract and provenance repair, not a parser, detector, language rule, answer-key signal, prompt shortcut, broader source access, model-route change, or finding-admission change. The mapper still must inspect scoped source, bind every fact to approved obligations, and return incomplete coverage when the map does not represent every obligation. The product stores no raw model output, source, prompt, or tool transcript.

## Verification

Focused tests prove strict role rejection at the model boundary, exact source-selection projection, quarantine of invalid plan/path/line references, and normal evidence-map/audit workflow behavior. A new five-repeat reviewed-plan same-route provider run is required after the protocol fingerprint changes. It must be reported as diagnostic until the separate dual-reviewed real-world corpus gate is met.

## Follow-up observation

The post-repair run completed three trials and admitted three findings, proving that the mapper defect was removed. It also showed that investigation, candidate grounding, and verification could complete without a scoped read or search, leaving 22 trials incomplete at later phases. All three stages now opt into the existing shared `requireScopedSourceInspection` lifecycle. An uninspected completion is retried within the same scope and then becomes explicit `coverage-incomplete`; it cannot silently produce a seed, canonical candidate, verifier decision, or finding. This aligns the implementation with the already-canonical source-inspection requirement without changing security semantics or adding language-specific logic.
