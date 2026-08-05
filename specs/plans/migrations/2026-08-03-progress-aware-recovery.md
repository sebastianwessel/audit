# Progress-aware, evidence-lossless recovery

Status: implemented and regression-verified on 2026-08-04. No compatibility
reader, source/work cap, or candidate-aware map-repair input was introduced.

## Decision

Plan 017 replaces blind same-input stage replay with an exact-binding,
source-free progress ledger and closes the recovery gap where a persisted
candidate-grounding draft erased unresolved per-seed outcomes. This is a
breaking artifact boundary: incomplete older grounding drafts and recovery
leaves are rejected, not translated or manually repaired.

## Contract

1. Every retryable semantic work unit has an append-only ledger of closed
   progress/failure signatures, inspection state, observation, and terminal
   transition. A repeated no-progress signature becomes explicit incomplete.
2. Strict-output repair supplies only closed validation categories and schema
   path labels to the next unchanged-scope attempt. It never carries raw output,
   model/provider text, source, context, tool payload, or rejected values.
3. Grounding drafts persist every canonical seed outcome. Explicit unfinished
   retry reuses grounded outcomes and reruns only `null` or `binding-rejected`
   outcomes with an unchanged candidate-blind predecessor binding.
4. A closed `map-insufficient` signal can invoke candidate-blind map repair.
   The repair may append valid neutral facts or close explicit incomplete; it
   cannot see candidate-aware or evaluator-only content.
5. Context-overflow children are marked partial. They are locally validated and
   become terminal only after complete, lossless reduction. Provider-backed
   reusable work requires an observation; deterministic work is explicit.

## Impact and verification

The canonical source is REL-009 through REL-014 in
`03-architecture/08-reliable-terminal-coverage-and-resume.md`. It applies to
the shared model-stage coordinator, evidence-map/posture/grounding checkpoints,
and evaluator resume. Tests must prove repeated validation signatures stop,
mixed seed recovery does not rerun grounded work, map repair remains
candidate-blind, partial leaves cannot be terminally reused, and missing
provider observations fail closed. No target access, parser, static detector,
answer-key path, compatibility reader, or evidence/work cap is introduced.

## Checklist walk

```yaml
checklist_walk:
  status: passed
  topics:
    contracts_generation:
      applicability: relevant
      evidence: ["REL-009", "REL-010", "REL-011", "REL-014"]
    async_recovery:
      applicability: relevant
      evidence: ["REL-009", "REL-013"]
    ai_automation:
      applicability: relevant
      evidence: ["REL-010", "REL-012", "REL-014"]
    security_privacy:
      applicability: relevant
      evidence: ["REL-010", "REL-012"]
    frontend:
      applicability: not_applicable
      evidence: ["The change has no frontend surface."]
  blocking_findings_count: 0
```
