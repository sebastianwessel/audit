# Plan-anchored semantic review

Status: implemented contract behavior for CAP-055. This capability strengthens
model reasoning only; it adds no parser, regex, language allowlist, static
security rule, benchmark condition, or answer-key dependency.

## Rationale

A plan category alone is too broad to keep a model's analysis tied to the
human-approved concern. Every enabled vector therefore contains one or more
explicit, risk-positive review obligations. Each obligation has a stable
`obligationId`, a `riskStatement`, and an `evidenceRequirement`. It is the
only review-unit identity used after plan execution starts.

`riskStatement` names both the source condition under review and its protected
security consequence; `evidenceRequirement` names the source relations and
controls needed to establish or negate that exact claim. They are a single
human/model semantic contract, not a taxonomy or a new deterministic security
rule. A generic coding pattern or a missing guard is not a substitute for the
named consequence.

## Required review protocol

For each candidate, discovery and grounding must preserve the exact approved
obligation set. They inspect scoped source for the claimed operation,
unsafe condition, and source-local controls relevant to each obligation. A
missing snippet is never proof of a bypass; a stage may return no candidate
with a visible limitation.

The verifier independently re-reads the same vector scope and decides whether
the supplied hypothesis answers its exact obligations. It must search for
source-local controls that could negate or qualify the claim. `accepted`
requires complete independently selected `operation` and `unsafe-condition`
evidence bundles for the same claim and vector; every bundle may retain several
map-projected locations plus an explanation. `rejected` requires source-backed
counterevidence and complete reconciliation; `incomplete` is required when
bounded static evidence cannot decide. A source-level behavior without
source/context evidence for the plan-required security consequence or
reachability is `incomplete` with `context-required`, not a confirmed claim.

When source supports it, model evidence can distinguish an entrypoint,
effecting operation, root control, and counterevidence. These are
model-supplied explanation roles, not required language constructs or
deterministic security rules. An accepted claim retains its vector, precise
statement, validated source evidence, limitations, and exact
source-free plan-obligation references. Prompts, raw tool results, raw model
output, and private reasoning are never persisted.

## Deterministic boundary

Every candidate and verifier result references one or more unique
`{ obligationId }` values. Its selected map facts and source-posture
assessments must bind those exact obligations. Before verification,
deterministic code projects every model-selected bundle location only from
validated map facts. It rejects invalid obligation references, bindings,
selection duplication, incomplete role sets, and impossible decision fields.
This is provenance validation only: it does not interpret the risk statement,
decide control effectiveness or data flow, or create a finding. A schema-valid
rejection is a completed negative decision; an incomplete model decision and
an operational failure remain distinct incomplete coverage states.

## Additional observations

Planning may separately emit `additionalObservations`: source-aware suggestions
for a human to consider when maintaining the audit plan. They have a stable
observation identity, suggested scope, and risk-positive review obligations,
but are not executable vectors, findings, priorities, fixes, or CI inputs.
The planner reserves executable vectors for target-specific materially
security-relevant review work that can reach a truthful source-backed terminal
outcome inside their own scope. It must not split one source behavior into
parallel restatements or create an enabled obligation only because an external
deployment, reachability, or business consequence might matter. An adjacent,
speculative, or context-dependent concern without source/context evidence of a
security-relevant boundary or consequence belongs in `additionalObservations`;
it may become executable only through explicit human promotion and resealing.
This planning discipline does not weaken audit closure: a promoted or
human-authored obligation whose required evidence remains unavailable is still
incomplete, while any independently accepted finding remains in the partial
audit report.
They appear in the sealed JSON plan and its Markdown projection under a
separate human-review section. An editable draft may promote a selected base
observation exactly once; resealing converts it to an enabled executable vector
and removes it from the observation list. An audit never executes, scores,
reports, or infers a security conclusion from an unpromoted observation.

Retired indexed obligation fields and old posture tokens fail closed; there is
no compatibility reader, alias, or inferred replacement.

## Tool and recovery behavior

The protocol uses only the per-vector `repo_list`, `repo_read`, and
`repo_grep` tools. It has no target shell, network, MCP, write, or unscoped
filesystem tool. A normal retry uses the exact same vector input. A normalized
provider context-window error uses the shared lossless recovery protocol. A
failed response or incomplete verifier never produces a static fallback
finding.

`repo_read` returns an ordered collection of exact physical `{ line, text }`
records. A model must cite only a returned `line` value that directly supports
its map fact or verifier selection; it must not count displayed text, use a
nearby delimiter/comment, or estimate a coordinate. `repo_grep` may locate
candidate areas, but exact source-evidence selection requires a subsequent
`repo_read`. This is a tool-provenance rule, not a source-language or
vulnerability interpretation.

Every model-stage input carries one closed `retryGuidance` value. `initial`
means produce the normal strict output. `output-validation` contains only a
stable signature and schema-path labels: the stage must correct those output
fields while preserving the exact scope, source-evidence discipline, and every
unrelated valid output. `source-inspection` means the previous completion did
not complete the required scoped read/search action, so the stage must inspect
the same scope before producing a conclusion. Instructions use one
feature-owned explanation of these semantics; they never receive a rejected
output, validation message/value, source, prompt, tool transcript, or provider
detail. A repeated validation signature is a typed no-progress incomplete
outcome, not an unbounded retry or broader inspection allowance.

## Evaluation and promotion

Provider evaluation uses the reviewed-plan profile, tool-guided evidence,
an explicitly recorded repeat count, compatible configuration identities, and evaluator-only answer
keys. It reports completion, detection, localization, patched matching
behavior, adjudicated false positives, unadjudicated outputs, agreement,
latency, token use, and cost only where the corpus supports those claims. A
diagnostic result is never an automatic product promotion.

## Acceptance

- Instructions require exact risk-positive obligation anchoring and
  source-local control review in discovery and verification, including the
  named security consequence rather than a generic code-pattern concern.
- Exact physical source-line records prevent models from estimating evidence
  coordinates; tests reject the former unnumbered `repo_read` response shape.
- All product references use the plan-owned `obligationId`; no indexed
  obligation contract remains.
- Unknown-extension source follows the same protocol.
- A verifier cannot create a different risk, vector, classification, urgency judgment, or remediation.
- An additional observation cannot enter audit coverage, findings, priority, CI
  gating, or evaluation scoring until a human promotes it into a resealed plan.
- Retry, recovery, telemetry, schemas, and strict source-free artifacts retain
  the exact obligation binding.
- Every live model-stage instruction explains the same closed retry-guidance
  semantics, and fake-provider tests prove retry inputs retain scope while
  correcting only the declared output shape.
