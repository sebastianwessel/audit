# Evaluation runner and report

## Execution model

The evaluator runs locally with no target network and no target execution. It validates the pack, copies or mounts an agent-visible fixture view inside a temporary jail, runs the normal plan/audit/report workflow with a fake or configured provider, then scores the validated report using trusted code. Answer keys and scorer modules are outside the agent sandbox and are never registered as Purista tools.

The runner must support `fixture` mode by default and `benchmark` mode only when an explicitly named offline pack is present. A live-provider flag is opt-in, requires credentials outside artifacts, and is rejected in the default CI environment. Failed, cancelled, incomplete, and safety-violating runs all remain visible in `EvaluationRunSchema` and cannot be coerced to a clean pass.

## Artifacts

Each run writes atomically:

- `evaluation-run.json` with configuration, digests, lifecycle, counters, per-case outcomes, metrics, and gate status;
- `evaluation-report.md` as a deterministic human projection;
- `case-results.jsonl` with one validated, source-free result and ordered execution trace per trial.

Each trace event identifies only a completed model response or a completed/rejected repository-tool operation. It records ordinal, operation id, timing, numeric usage/cost or returned-byte count, and a stable error code. Trace events never contain source paths/content, context, prompts, answer keys, provider request ids, tool arguments/results, secrets, or raw model output. The report renders a human-readable per-trial flow; `case-results.jsonl` is the complete queryable record.

## CI behavior

CI runs schema/fixture validation, safety fixtures, fake-provider end-to-end conformance, scoring, and report projection checks. It does not require provider credentials or network access. The provider-free `bun run eval` command is a harness-isolation smoke check: its intentionally blank responder reports an unmet semantic `gatePassed` value but exits successfully when no safety violation occurs. The fixture suite also proves one complete reviewed-plan lifecycle and an exact no-dispatch resume, but deliberately uses a non-adjudicated source location and requires a failed workflow gate; it is protocol evidence, never a model-quality or security result. The targeted provisional seed has no checked-in precision baseline. Semantic threshold gates belong only to an explicit provider benchmark and an exhaustive reviewed baseline with matching coverage class, pack, profile, and route. They fail when a hard safety gate fails, a required case is missing, a report is invalid, a critical/high case becomes an unreviewed miss, or an exhaustive-qualified aggregate threshold regresses. Baseline changes require a dated review note and a new evaluation report.

## Implementation placement

The evaluator is a `src/features/evaluation/` vertical slice. Its schemas, pure matching/scoring rules, manifest validation, source-free trace projection, and report projection each keep colocated tests. Cross-feature execution tests belong under `tests/integration/` and `tests/e2e/`; fixture files and support helpers belong under `evaluation/` and `tests/support/`, respectively.
