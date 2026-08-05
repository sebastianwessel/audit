# Provider transport and grounding-draft recovery

Status: implemented and offline-verified on 2026-08-04. This migration supersedes any wording that
allows a live model contract to reach a provider without a declared transport
compatibility profile or treats a canonical grounding draft as reusable only
after a later verifier/countercheck checkpoint exists. There is no legacy
reader, migration, or compatibility mode.

## Decision

1. One platform-owned registry declares every live structured model-output
   schema: product workflow, plan-semantic evaluator, and stage-isolated
   evaluator. The pure compatibility gate selects the exact dispatched registry
   entries and runs before target/corpus I/O, provider construction, lock or
   artifact/checkpoint work, or model dispatch.
   Its profile/schema fingerprint is a resume identity input. An undeclared or
   incompatible profile fails closed with a source-free stable code.
2. A strict provider-required root-object envelope is a lossless transport
   adapter only. It wraps one canonical semantic result and is unwrapped once
   at the owning feature stage. It never changes the canonical result,
   finding-admission contract, checkpoint/report schema, or score.
3. An opt-in evaluator-private debug diagnostic may retain only allowlisted
   source-free failure metadata for scoped audit, plan-semantic, and
   stage-isolated evaluator calls. It is absent from product commands and all
   public/normal evaluator artifacts; it cannot alter observations, scoring,
   baselines, comparisons, checkpoints, reuse, telemetry, or outcome. Its
   atomic private write is best-effort: a failed write cannot create a durable
   marker without violating that boundary and is therefore not represented in
   product or normal evaluation state.
   Its private write is best-effort: an unavailable destination cannot promise
   a durable marker for its own failure.
4. A validated exact canonical grounding draft is a resume boundary even if no
   candidate-aware checkpoint has been written. One pure resolver retains all
   durable predecessors and observations and schedules only the smallest exact
   unfinished seed or candidate-aware unit. Incompatible identity is rejected;
   completed work is never replayed to recreate a later checkpoint.

## Required implementation

- Reject legacy artifacts that lack the new transport-identity binding rather
  than translating or reusing them.
- Keep the compatibility validator in the platform/harness boundary and the
  canonical semantic contract/materialization in its owning feature.
- Keep evaluator debug output below ignored private evaluator work, atomic,
  redacted, and outside product/public artifact roots.
- Extend the same recovery resolver and crash-boundary matrix for any future
  checkpoint phase before making that phase reusable.

## Verification

- Offline profile tests reject an incompatible root schema before all target,
  provider, and artifact effects; valid envelopes materialize the same
  canonical result exactly once.
- Evaluation tests prove debug data is opt-in, redacted, non-scoring, and not
  present in normal/public artifacts.
- Crash-boundary tests prove a draft-only resume does not repeat completed
  mapping, posture, discovery, or grounding work and reconstructs cost from
  retained observations once.
