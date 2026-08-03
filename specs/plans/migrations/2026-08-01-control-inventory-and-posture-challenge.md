# Control inventory and candidate-blind challenge

Status: approved

## Problem

The bounded reviewed-plan provider probe completed all five audit stages and every scoped source inspection, yet returned a finding for each patched trial. The verifier structurally considered every control fact it received, but the evidence map had no contract requiring a mapper to declare which controls it had considered. A later stage could therefore satisfy control-coverage checks vacuously when an upstream model omitted a source-visible safeguard.

This is a generic evidence-provenance and processing failure. It is not a JavaScript-specific pattern, a benchmark exception, a parser problem, or evidence that an answer key should be widened to match the model.

## Contract

1. `UnverifiedEvidenceMapSchema` adds `controlCoverage`: exactly one `{ obligationId, controlFactIds }` entry for every approved obligation. Identifiers are distinct within each entry.
2. The map verifier retains source-valid facts first, then requires each declared entry to exactly equal the retained neutral `control` facts bound to that obligation. A missing, extra, or stale identifier makes map coverage incomplete; it never creates a finding or source-semantic verdict.
3. Source-posture validation requires each assessment to cite every retained neutral control fact bound to its exact obligation. A missing control reference rejects that assessment and makes the vector incomplete.
4. The sole `mappedControlFactIdsForObligation` projection is reused by posture validation, verifier selection-basis construction, and terminal control-evidence validation. No feature reimplements role filtering.
5. Context-overflow recovery unions the declared control identifiers for each exact obligation before map integrity validation. It does not pre-split, widen scope, drop a partition, or derive source semantics.
6. Mapper, posture, and verifier instructions require an active control challenge while keeping conclusions model-owned. Deterministic code still validates only schema shape, provenance, scope, exact references, and lifecycle state.

## Measurement and rollout

The existing $0.539349, 10-trial reviewed-plan probe remains the pre-change diagnostic baseline: 10/10 completed, 0/5 vulnerable expected finding matches, 5/5 vulnerable false negatives, and five patched outputs with unadjudicated additional findings. It cannot establish precision or reliability because the selected case is provisional and targeted.

No further provider call is required to promote this structural contract change. Focused contract/workflow tests and the provider-free full suite prove the new boundary. A later five-repeat probe against a qualified paired case measures whether explicit control inventory improves semantic discrimination; it must retain the same reviewed-plan profile, scope, repeat count, and content-free trace protocol, and it must not alter answer keys, add static rules, or use paired labels in product inputs.
