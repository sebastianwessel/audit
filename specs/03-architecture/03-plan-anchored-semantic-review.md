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

## Required review protocol

For each candidate, discovery and grounding must preserve the exact approved
obligation set. They inspect scoped source for the claimed operation,
unsafe condition, and source-local controls relevant to each obligation. A
missing snippet is never proof of a bypass; a stage may return no candidate
with a visible limitation.

The verifier independently re-reads the same vector scope and decides whether
the supplied hypothesis answers its exact obligations. It must search for
source-local controls that could negate or qualify the claim. `accepted`
requires reconciled `operation` and `unsafe-condition` evidence for the same
claim and vector; `rejected` requires a source-backed contradiction; and
`incomplete` is required when bounded static evidence cannot decide.

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
deterministic code projects model-selected locations only from validated map
facts. It rejects invalid obligation references, bindings, and selections.
This is provenance validation only: it does not interpret the risk statement,
decide control effectiveness or data flow, or create a finding.

Retired indexed obligation fields and old posture tokens fail closed; there is
no compatibility reader, alias, or inferred replacement.

## Tool and recovery behavior

The protocol uses only the per-vector `repo_list`, `repo_read`, and
`repo_grep` tools. It has no target shell, network, MCP, write, or unscoped
filesystem tool. A normal retry uses the exact same vector input. A normalized
provider context-window error uses the shared lossless recovery protocol. A
failed response or incomplete verifier never produces a static fallback
finding.

## Evaluation and promotion

Provider evaluation uses the reviewed-plan profile, tool-guided evidence,
five repeats, compatible configuration identities, and evaluator-only answer
keys. It reports completion, detection, localization, patched matching
behavior, adjudicated false positives, unadjudicated outputs, agreement,
latency, token use, and cost only where the corpus supports those claims. A
diagnostic result is never an automatic product promotion.

## Acceptance

- Instructions require exact risk-positive obligation anchoring and
  source-local control review in discovery and verification.
- All product references use the plan-owned `obligationId`; no indexed
  obligation contract remains.
- Unknown-extension source follows the same protocol.
- A verifier cannot create a different risk, vector, classification, urgency judgment, or remediation.
- Retry, recovery, telemetry, schemas, and strict source-free artifacts retain
  the exact obligation binding.
