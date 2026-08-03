# Candidate-blind source posture migration

Status: auto-approved by standing product-owner instruction.

## Why

The five-repeat same-route seed run recorded complete structural admission for most model candidates while patched variants still produced false positives. The prior verifier therefore validated shape and source references without reliably falsifying a claim already framed by the investigator. An optional second model route is retained only for evaluation; it is not a remedy for this root cause.

## Change

Insert `source-posture` between validated evidence mapping and investigation. It is a fresh, same-route, vector-scoped model session that receives the approved vector, neutral map, labelled advisory context, and scoped read-only tools. It must not receive candidates, findings, priority, fixes, verdicts, answer keys, benchmark labels, or paired vulnerable/patched information.

The posture returns one assessment per evidence question with a conclusion (`supported`, `contradicted`, or `inconclusive`), map fact references, and limitations. Deterministic code validates only closed schema shape, exact question coverage, map membership, and matching question bindings. It must never infer, override, or score the conclusion.

An investigator candidate now cites `sourcePostureAssessmentIds`. Each of its approved plan obligations requires a cited assessment and inclusion of that assessment's map facts. A posture conclusion is evidence context, not a deterministic `supported`-only veto. Missing or malformed posture evidence yields visible incomplete coverage or a counted integrity rejection; contradicted or inconclusive evidence remains visible for the investigator and verifier to reconcile.

## Artifact and recovery boundary

- Report schema advances from v4 to v5.
- Terminal vector checkpoint and investigation draft advance from v3 to v4.
- `AuditSourcePostureDraftSchema` v1 is a separately reusable validated/redacted checkpoint.
- Stage telemetry adds `source-posture`; run totals derive from every retained stage observation.
- A prompt-protocol change makes the pre-posture baseline descriptively comparable only. It cannot pass/fail a strict baseline comparison.

## Evaluation decision

Run the existing reviewed-plan, same-route provider corpus with five or more repeats only after local contract, recovery, schema, and full test checks pass. Compare source-free outcome and cost data descriptively against the July 30 baseline. Do not make a reliability or promotion claim unless the qualified dual-reviewed real-world corpus and private-holdout gates are met.

## First measurement — not promoted

Run `reviewed-plan-same-route-source-posture-20260730` completed all 30 trials on the mixed-language seed with no safety violations. Its prompt protocol changed, so this is a descriptive comparison with `reviewed-plan-same-route-claim-path-20260730`, not a baseline pass/fail comparison.

| Measure | Pre-posture diagnostic | Source-posture diagnostic | Decision |
| --- | ---: | ---: | --- |
| Completion | 30/30 | 30/30 | Recovery and operational behavior are sound. |
| Finding agreement | 0.383 | 0.450 | Stability improved modestly but remains inadequate. |
| Vulnerable false negatives | 3 | 10 | Regression; blocks promotion. |
| Patched/benign false positives | 6 | 5 | Small improvement does not offset the recall regression. |
| Estimated cost | $1.285208 | $1.361596 | +$0.076388; not justified by quality. |
| p95 latency | 41.207 s | 43.869 s | +2.662 s. |

The hard requirement that a candidate cite a `supported` posture did not solve same-route confirmation bias. It suppressed valid candidates on Java and C cases while still admitting false positives on patched JavaScript cases. Keep the telemetry, contracts, and checkpointing as reusable infrastructure, but do not use this result to claim that the product is reliable or ready for promotion. The successor design keeps posture as candidate-blind evidence context and makes accepted verification structurally cover every source-backed, obligation-relevant mapped control fact. It does not decide whether a control works; it prevents the verifier from silently overlooking one. It adds no language-specific rule, parser, benchmark exception, answer-key exposure, or alternate-provider workaround.

## Second measurement — control reconciliation still not promoted

Run `reviewed-plan-same-route-counterevidence-reconciliation-20260730` completed all 30 trials with the same mixed-language seed, reviewed-plan profile, route, model, tool-assisted delivery, concurrency, and repeat count. It changes the prompt protocol and remains only descriptively comparable with the previous diagnostic.

| Measure | Source-posture diagnostic | Control-reconciliation diagnostic | Decision |
| --- | ---: | ---: | --- |
| Completion | 30/30 | 30/30 | Recovery and safety behavior remain sound. |
| Finding agreement | 0.450 | 0.617 | Stability improved, but it is not a reliability result. |
| Vulnerable false negatives | 10 | 11 | Regression; blocks promotion. |
| Patched/benign false positives | 5 | 6 | Regression; blocks promotion. |
| Estimated cost | $1.361596 | $1.321490 | -$0.040106, not a quality justification. |
| p95 latency | 43.869 s | 41.265 s | -2.604 s. |

The verifier-control coverage mechanism operated as designed: all accepted verifier results structurally covered their obligation-relevant mapped controls, and no deterministic code decided whether any control worked. The aggregate evidence nevertheless shows that the main loss occurred earlier for some vulnerable trials: five C candidates were rejected by existing structural integrity admission before verifier invocation, so control reconciliation could neither repair nor evaluate them. This observation does **not** justify a C-specific exception or weaken evidence integrity. It identifies the next general design question: how a model can iteratively reconcile an already bounded candidate with the canonical map/posture/claim-path contract after a content-free structural rejection, without exposing answer keys, adding semantic rules, widening scope, or fabricating a finding. Any such repair loop must be separately specified, preserve exact phase bindings and source scope, checkpoint its validated inputs and rejection category, remain same-route, and be evaluated from a newly registered prompt fingerprint before implementation is promoted.

## Candidate repair decision

CAP-068 implements that general question as one bounded `candidate-repair` stage per vector, not a fallback detector or a second security decision. It receives only repairable candidates from the current in-memory investigator response, stable structural rejection categories, the approved vector, validated map, candidate-blind posture, path manifest, labelled context, and the same scoped read-only tools. It cannot receive an answer key, a paired variant, another vector, a broader source view, a prior verifier verdict, or a raw persisted response.

A repair result is paired with one original candidate and is either `null` or a replacement that retains the original vector, title, priority, confidence, summary, impact, and proposed fix exactly. It may correct evidence locations/roles, plan-obligation references, map/posture references, claim-path references, and limitations only. The ordinary canonical admission boundary validates the replacement again; no repair output bypasses it. Vector mismatch is never repairable. Deterministic code validates pairing, preserved identity, scope, source lines, map/posture membership, and phase binding only; it does not decide whether the candidate describes a vulnerability or whether a control works.

The stage has one bounded execution and one shared vector tool budget; its provider attempts follow the configured stage retry policy. Its content-free stage observation is retained separately. Only a completed stage with a canonical, redacted repaired hypothesis set is checkpointed and reusable for verification. A failed/empty/invalid repair retains no raw candidate, so resume safely returns to the matching posture or investigation predecessor. The exact prompt protocol fingerprint binds repair reuse and measurement. No live promotion claim is permitted until a five-repeat measurement with an unchanged corpus/split/route/model/tool budget and a newly registered prompt identity completes, followed by the existing qualified-corpus and private-holdout gates.
