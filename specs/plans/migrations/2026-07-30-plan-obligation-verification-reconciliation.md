# Plan-obligation verification reconciliation

Status: implementation authorized by the product owner after the five-repeat `posture-provenance-projection-reviewed-20260730` diagnostic removed all posture-reference structural rejections but still recorded zero verifier rejections, eight vulnerable false negatives, and five patched/benign false positives. This is a generic claim-verification repair, not a language rule, parser, model-route change, corpus adjustment, or answer-key-derived policy.

## Problem and decision

The existing verifier carried a candidate's exact approved plan obligations into its canonical result, but the model never had to make a source-backed disposition for each obligation. A verifier could therefore accept a claim while treating the obligation list as copied metadata. The diagnostic's zero source-backed rejections shows that the present control/posture fields do not provide a sufficiently explicit claim challenge.

Every accepted verifier or evaluation-only countercheck result must now contain exactly one **plan-obligation reconciliation** for every obligation referenced by its hypothesis. A reconciliation contains the existing canonical claim disposition token (`supports-claim`, `contradicts-claim`, or `unresolved`), bounded explanation, and one or more selected locations from validated map facts that bind that exact question-and-success-criterion pair. The model may use any such mapped fact, including counterevidence; it is not limited to the investigator's selected facts.

An accepted result has exact reconciliation coverage and no `unresolved` reconciliation. `contradicts-claim` remains a declared model judgment, not a deterministic security decision: deterministic code validates only exact obligation identity, coverage, selected map-fact membership, source-location projection, and closed shape. It must not infer whether any disposition, source/control/effect/boundary relationship, data flow, or impact is semantically correct. Rejected and incomplete decisions continue to carry no canonical evidence because they do not create reportable findings.

## Contract and ownership

`audit-execution/verification/contract` owns the reconciliation schemas and inferred types. It reuses, rather than duplicates, `PlanObligationReferenceSchema`, `PlanObligationReferencesSchema`, `hasExactPlanObligations`, the existing claim-reconciliation disposition schema, evidence-map selection schema, source-claim evidence schema, and bounded explanation shape. `materializeVerificationResult` is the sole owner of projection from a model selection to canonical source evidence.

Both `review-workflow/agents/verification` and the evaluation-only `countercheck` use the same model output schema. Their instructions require source-first assessment of the smallest static claim tuple relevant to each approved obligation: trigger/boundary when applicable, source-local control, effecting operation or unsafe condition, counterevidence, and proof gap. This is reasoning guidance, not a fixed finding taxonomy; models must record a limitation or return incomplete when bounded static evidence cannot establish an obligation.

No prompt embeds a language, extension, parser, API, benchmark, source-specific condition, paired-variant signal, or answer key. No mounted external skill is introduced: Codex Security's extensive catalog includes workflow-specific and language/family examples that would expand product scope. Only its general static-assessment discipline is adapted as this plan-owned, typed contract.

## Lifecycle, recovery, and observability

The reconciliation is transient verifier evidence projected only for accepted findings, following the existing redaction and report lifecycle. It adds no raw prompt, model output, tool transcript, source text, or evaluator data to telemetry or checkpoints. The current prompt-protocol fingerprint changes, so an existing candidate-grounding draft can retry only under its exact new protocol; old terminal artifacts are never reinterpreted. The existing stage ledger and source-free admission funnel remain unchanged because this is an accepted-result integrity condition, not a new security verdict category.

## Acceptance

1. Accepted verifier and countercheck model outputs require one source-selection reconciliation per exact hypothesis obligation and reject duplicate, missing, out-of-hypothesis, unbound, or unresolved accepted reconciliations.
2. Canonical materialization projects reconciliation evidence only from map facts bound to the exact obligation and fails closed on invalid selections.
3. The existing control, posture, scoped tool-use, source-evidence, source-posture, redaction, and phase-boundary rules remain intact.
4. Unknown-extension source follows the same schema and model protocol without a parser or language-specific branch.
5. Contract, materialization, harness, audit, recovery, privacy, schema, and full local checks pass before an opt-in provider measurement using the unchanged pack/profile/model/route, an explicitly recorded repeat count, and a new prompt-protocol fingerprint.
6. The measurement is diagnostic only. Promotion requires the separately specified qualified, repository-disjoint, dual-reviewed corpus and private holdout; one case, language, median, or structural result cannot promote the behavior.
