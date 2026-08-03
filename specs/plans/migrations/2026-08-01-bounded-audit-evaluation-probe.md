# Bounded audit-evaluation probe

Status: implementation authorized by the product owner.

## Purpose

Make one full-workflow reviewed-plan provider experiment cost-bounded and diagnostically useful without changing product audit behavior or exposing evaluator answer keys.

## Contract

- `eval:provider --case-id <id>` selects one evaluator case from the already selected split, before any model request.
- The runner executes all declared variants of that case; a paired case therefore measures its vulnerable and patched variants for every required repetition.
- The exact selector is recorded in the configuration fingerprint, checkpoint, run JSON, Markdown report, and JSONL trial trace. A changed selector cannot resume or compare as the same experiment.
- The selector is evaluator-only. It never enters the target jail, planner/audit prompt, repository tools, reviewed plan, answer key, or product report.
- The first probe uses `reviewed-plan` and `full-workflow`, so audit behavior is measured independently of generated-plan behavior. Five repetitions remain mandatory. The configured observed-cost ceiling is a dispatch guard, not an input/output/tool cap.
- Offline proof uses the existing fake-provider full lifecycle. It must cover evidence mapping, source posture, discovery, candidate grounding, and verification, and prove every stage has a validated ordered trace plus exact no-dispatch resume.
- A resulting targeted or provisional measurement is diagnostic only. It cannot create a reliability, precision, or release claim.

## Verification

- CLI/runner tests cover selection, unknown/cross-split failure before model dispatch, all-variant execution, and resume binding.
- Fake-provider full workflow covers five audit stages, complete trace ordering, and no-dispatch resume.
- Provider execution is a single explicit, cost-capped run only after offline verification passes.
