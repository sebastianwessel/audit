# Evaluation semantic-rubric integrity

Status: implemented and offline-verified on 2026-08-04. No compatibility
reader, digest translation, or readiness override is permitted.

## Decision

1. The evaluator-only plan-semantic model input and its identity digest contain
   only scenario identity and semantic review criteria: scenario id, objective,
   source-only applicability, required risk condition, and evidence
   requirements. They exclude answer-key paths, expected-finding identifiers,
   source ranges, and every location-equivalent field.
2. Deterministic path reachability and terminal finding scoring retain the
   source-bound answer-key path, identifier, and range data after product work
   closes. They never provide those fields to the semantic evaluator.
3. A `dual-reviewed` answer key means exactly two distinct matching human
   `include` records. AI-assisted records cannot satisfy dual-review, pilot,
   holdout, language/control-family, or reliability readiness.
4. An `ai-assisted` key remains available only for the explicit
   `development-calibration` eligibility contract. It remains internal,
   diagnostic evidence and is never relabelled as human or independent review.

## Recovery and verification

- The semantic-rubric digest changes when any model-visible semantic criterion
  changes and does not change for a path-only or expected-finding-location-only
  answer-key edit. Existing checkpoints with a non-matching digest are not
  reusable.
- Contract tests prove model input omits answer-key-only path and finding-id
  sentinels, and corpus validation rejects AI-assisted records in a
  `dual-reviewed` key.
- Readiness reports label dual-reviewed counts as human-dual-reviewed and
  retain a separately labelled AI-assisted calibration lane.
