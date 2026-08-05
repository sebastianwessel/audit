# Verifier recovery and phase-failure integrity

Status: implemented and regression-verified on 2026-08-04. The source-free
continuation smoke subsequently confirmed that a later verifier failure retains
the completed map, posture, investigation, and grounding observations and their
catalogue-backed cost. It is operational evidence only, not a finding-quality
claim.

## Problem

The shared context-overflow lifecycle can partition map, posture, investigation, and grounding phases, but verification has no lossless reducer, no durable topology, and collapses an overflow into a generic failed verifier result. Separately, `runAudit` converts any unexpected vector error into an investigation failure, losing the actual failed phase and prior completed observations.

## Contract

1. Every source-deciding model phase, including verifier and experimental countercheck, records a provider-signalled context overflow in a phase-bound source-free topology. A context overflow is never relabelled as a generic provider failure.
2. A verifier/countercheck overflow topology persists only inside its exact candidate-aware checkpoint. The enclosing checkpoint binds the candidate digest, verifier route, phase, ordinal, and complete run identity; the topology binds the recovery protocol and root-scope fingerprint. No child decision artifact exists because no child decision is reusable.
3. A verifier decision is admitted only when it is losslessly derived from one unchanged candidate hypothesis and reconciles every required obligation, posture assessment, and selected map evidence. A normalized root overflow records its candidate-bound topology and ends as explicit `provider-context-overflow` coverage incompleteness without dispatching child splits. An exact explicit retry observes that known non-lossless topology and makes no further provider call; it never produces a merged, clean, rejected, or accepted result by deterministic inference.
4. The execution core receives one opaque validated resume state, not independent raw prior-artifact arrays. The loader owns binding, duplicate, and reusable-versus-observed decisions; the core cannot reuse a result by vector id alone.
5. All vector failures are phase-accurate. A typed internal failure envelope carries the stable error code, actual phase, completed phase observations, and artifact-versus-provider classification. Checkpoint-write failures remain artifact failures and do not masquerade as investigation failures.
6. A terminal result retains every completed phase observation before its failure. Its coverage/error/terminal lane must state the same failure class without source or model content.
7. The recovery protocol fingerprint changes whenever deterministic child ownership changes. The grounding ownership repair is protocol version 2, so no leaf produced by the prior ambiguous reducer is reusable.
8. Canonical grounding recovery may dispatch only a child that owns a complete seed basis: every selected map fact, every projected posture assessment, and every projected source-evidence location lies inside the child's exact source path/range scope. A child with no owned seed records no model call and contributes an explicit empty canonical output. A seed that crosses a source child or an overflow requiring context-only partitioning ends as `provider-context-overflow`; it is never filtered to `null`, duplicated, or reduced across context fragments.

## Non-goals

- No parser, language rule, static detector, answer-key-derived logic, scope broadening, or extra model route.
- No replay of a completed child without its exact validated artifact.
- No fallback verdict and no finding admission after incomplete verifier recovery.

## Required tests

- Provider-normalized verifier overflow records phase-bound topology and returns explicit `provider-context-overflow` incompleteness without an admitted finding.
- Exact compatible verifier recovery leaf reuse avoids a provider call; a mismatched candidate, route, scope, or topology is rejected before dispatch.
- A non-lossless verifier split has terminal incomplete coverage and preserves all prior stage observations.
- Injected failures after evidence map, posture, investigation, grounding, verifier, and checkpoint persistence each retain their true phase and previous observations.
- The validated resume-state loader rejects duplicate/mismatched artifacts and audit core exposes no raw prior arrays.
- Full offline suite and schema generation remain green.
