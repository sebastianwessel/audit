# Lossless claim-selection lineage

## Decision

Discovery, grounding, and accepted verification now preserve the same
role-labelled neutral-map selection lineage. Discovery records only existing
`{ factId, evidenceIndex }` selections for one operation and one
unsafe-condition role; it does not author source locations or produce a
finding. Grounding and accepted verification may add valid selections, but may
not drop or reassign an inherited one. One selection may serve both roles.

## Rationale

The 2026-08-04 development-calibration pair showed that a flat discovery map
fact list forced grounding to reconstruct role assignment. The vulnerable
trial reached verification with only one expected role grounded and therefore
correctly remained incomplete. Preserving model-owned map references removes
that lossy handoff without adding a parser, source-text heuristic, benchmark
exception, static security rule, fallback detector, or second provider route.

## Boundaries

- Deterministic code validates only selection identity, map membership, index
  range, role preservation, scope, and schema shape.
- It never infers which source fact is an operation or unsafe condition, a
  relationship, exploitability, classification, urgency, or remediation.
- Discovery seeds and raw model output remain non-persisted. Canonical
  hypotheses retain only source-minimal projected evidence and map-selection
  lineage for exact verifier recovery.

## Verification

- Contract tests reject absent, reassigned, or dropped inherited selections.
- Stage tests prove the prompt protocol changes and preserves same-scope tool
  behavior.
- Resume tests prove canonical candidates retain exact lineage without a new
  discovery or grounding request.
- The full offline suite proves schema, redaction, language neutrality, and
  no-static-rule boundaries.
