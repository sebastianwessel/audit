# Finding contract, enterprise reporting, and data protection

- **Priority:** P0/P1
- **Effort:** L
- **Risk:** High
- **Status:** Proposed

## Overview

Define a truthful, internally consistent end-user outcome for every audit obligation and every confirmed finding. Separate confirmation from enterprise triage: source-backed admission happens first; priority, impact, and remediation are later enrichment that cannot create or suppress a finding. Minimize durable sensitive content, render complete evidence safely, and support JSON, Markdown, SARIF, and lineage without overstating causal attack chains.

## Problem statement

Current confirmed findings persist with status `candidate`, report headings call them confirmed, only the first evidence item is shown, and finding identity depends on model wording plus an absolute line. “Attack chains” are only same-file groups. Model-authored prose and source snippets persist under a narrow regex redactor. Persisted schemas allow contradictory counts/closures. Business-level checks that cannot be proven by a code operation/unsafe-condition pair are skipped or forced into the wrong shape. The originally requested critical/high/medium/low priority and proposed fix do not exist because specs exclude them from confirmation entirely.

## Proposed solution

### Separate closure, confirmation, and triage

Use three independent strict contracts:

1. **Obligation closure** answers whether planned work completed:
   - `finding-confirmed`
   - `candidate-rejected`
   - `no-source-backed-candidate`
   - `not-applicable`
   - `needs-review`
   - `incomplete`
   - `cancelled`
   - `failed`

2. **Confirmed finding** contains only source-backed security truth and provenance:
   - scan-local finding ID;
   - stable plan vector/obligation references;
   - concise root-cause statement;
   - all mandatory evidence roles and exact source snapshot references;
   - verified controls/counterevidence considered;
   - verifier disposition/protocol identity;
   - limitations;
   - stable partial fingerprints for lineage.

3. **Triage enrichment** is report-only metadata:
   - priority: `critical | high | medium | low | unassessed`;
   - priority rationale and inputs;
   - optional CVSS v4 Base/Threat/Environmental vector components and score source;
   - business impact/data classification/affected boundary;
   - proposed remediation and validation approach;
   - feasibility/assumptions;
   - enrichment status/error/route observation.

Admission code never reads triage enrichment. A triage failure leaves a confirmed finding with `unassessed` priority and explicit limitation; it cannot remove the finding or make the audit incomplete if confirmation itself completed.

### Business-level obligations and applicability

Extend plan obligations with explicit strict fields (names may be refined in specs, but semantics are fixed):

- `objective`: the audit question in business/security terms;
- `riskCondition`: the unsafe condition to seek;
- `evidenceRequirements`: one or more requirements;
- `evidenceBasis`: `source`, `source-and-context`, or `context-applicability`;
- `applicabilityCriteria`: what makes the check applicable/not applicable;
- `scope`: admitted source/config paths and applicable context selectors;
- `completionCriteria`: required evidence roles or reason state.

Rules:

- A confirmed vulnerability/security finding always has source/configuration evidence from the immutable target snapshot. Context may explain environment/impact but cannot be the sole proof of source behavior.
- Context can support a neutral N/A determination only when its declared applicability and any relevant source/configuration evidence agree. Context cannot suppress contrary source evidence.
- Missing deployment/business evidence is `incomplete/not-verifiable-from-provided-evidence`, not N/A and not pass.
- Every N/A closure includes the exact obligation, crisp reason, evidence/context references, and verifier identity.

### Artifact data classes

Define and enforce four classes:

| Class | Contents | Default persistence |
| --- | --- | --- |
| Operational | IDs, hashes, counts, closed states, timings, stable errors, token/cost | Persisted in normal artifacts |
| Evidence reference | Snapshot digest, relative path, byte/line range, role, content digest | Persisted in findings/reports |
| Protected detail | Redacted source snippet, model explanation, context excerpt | Separate local protected artifact, explicit opt-in/retention |
| Forbidden | API keys, credentials, raw provider requests/IDs, secret values, full prompts/source/tool content in product mode | Never persisted |

The canonical JSON report should be useful without raw snippets. A local renderer may resolve references against the matching snapshot/protected detail store. If evidence is unavailable, it reports that explicitly rather than fabricating text.

Apply one centralized artifact-safe text boundary to every model-authored string before persistence or rendering. It must:

- reject NUL and unsafe terminal/control characters;
- neutralize Markdown/HTML where appropriate;
- redact recognized credentials, private-key blocks, JWT/cloud token patterns, connection URLs, and configured organization patterns;
- replace sensitive values with type labels, never hashes that enable offline guessing;
- record only a source-free redaction count/type summary.

Because regex redaction is incomplete by nature, minimization and protected storage are the primary controls.

### Finding identity and lineage

- Use a scan-local `findingId` for exact artifact references.
- Produce multiple versioned `partialFingerprints`, including obligation/root-cause identity and language-neutral content anchors around operation/unsafe-condition evidence. Absolute line numbers may locate evidence but never be the sole stable fingerprint.
- Identity uses all mandatory roles, not `evidence[0]`.
- Lineage matching is conservative and artifact-only. Exact fingerprint match can establish persistence; ambiguous matches become `unknown/needs-review`. Incomplete vector coverage remains `unknown`, never resolved.
- Evaluation pairs match evaluator-owned expected finding IDs, not production line-based identity.

### Reporting

Canonical outputs:

- **JSON:** complete strict machine contract and source of truth.
- **Markdown:** safe standalone human narrative with summary, coverage matrix, N/A/incomplete sections, confirmed findings, all evidence roles/controls, priority/impact/remediation, limitations, cost/operations, and no links to internal specs.
- **SARIF 2.1.0:** rule/requirement IDs, locations, related locations/codeFlows when genuinely supported, partial fingerprints, baseline state, and suppressions represented as consumer-owned metadata. Do not emit a causal code flow when only locations are known.
- **CI summary:** counts and exit semantics only; no sensitive snippets.

Replace `AttackChain` with either:

- `RelatedFindingGroup` explicitly labelled as co-location/shared obligation/control metadata; or
- a future `VerifiedAttackChain` requiring a separate model decision over ordered source-backed edges and independent verification.

Do not keep the current same-first-file object under an attack-chain name.

### Relational schema invariants

At parse/finalization boundaries enforce:

- exactly one closure per enabled obligation;
- N/A always has reason and no finding/pass count;
- confirmed findings reference terminal admitted closures and exact vector obligations;
- every mandatory evidence role is present and paths/ranges/digests exist in the snapshot;
- counts equal child collections and phase ledger projections;
- findings and review-required collections are disjoint;
- triage references an existing confirmed finding and cannot alter identity/admission;
- attack/related groups reference existing findings and cannot duplicate members;
- terminal report status matches enabled obligation states and exit code.

## Implementation steps

### Ticket 3.1 — Specify closure and finding vNext

1. Update product, artifact, finding, lineage, security, and evaluation specs. Explicitly separate confirmation from triage/remediation.
2. Define new strict Zod schemas in feature-owned modules and infer every type.
3. Remove obsolete candidate/legacy fields, dead counters, context/inventory evidence kinds that cannot be projected, and compatibility branches.
4. Add cross-field refinements and generated JSON Schema contract tests.
5. Reject older reports/checkpoints/plans; bump all affected schema/protocol versions together.

### Ticket 3.2 — Add business-level applicability/evidence contracts

1. Extend plan vector/obligation schemas with applicability and evidence-basis fields.
2. Update map/discovery/verification projections so source, configuration, and applicable context remain distinctly labelled.
3. Add `not-verifiable-from-provided-evidence` as an explicit incomplete reason, not a clean closure.
4. Add fixtures for tenancy/business authorization, data retention/PII, deployment control, secret handling, and a genuinely N/A check across multiple implementation languages.
5. Test conflicting context/source: source wins for code behavior; contradiction becomes limitation/review item.

### Ticket 3.3 — Minimize and protect artifacts

1. Create a feature-owned artifact data-class policy and centralized safe-text projection.
2. Remove raw snippets from default durable finding identity/report JSON; persist evidence content digests/references.
3. Implement optional protected detail storage with restrictive permissions, explicit CLI opt-in, and retention metadata.
4. Apply safe-text projection to plan prose, map facts, posture/coverage reasons, seeds/candidates, verifier reasons, triage, errors, and Markdown.
5. Add canary tests covering secret formats, private keys, JWTs, DB URLs, cloud keys, PII examples, control characters, Markdown/HTML injection, Unicode, and false-redaction behavior.

### Ticket 3.4 — Implement stable identity and lineage

1. Replace wording+line finding ID with scan-local identity plus versioned partial fingerprints.
2. Implement language-neutral content anchors without using them to infer security semantics.
3. Update lineage to compare only compatible complete artifacts and return unknown for ambiguity/incomplete scope.
4. Update evaluator pairing to expected finding IDs with variant-specific accepted evidence ranges.
5. Add line-shift, wording-change, small-code-change, ambiguous-multiple-match, incomplete-coverage, and path-move tests.

### Ticket 3.5 — Add post-confirmation enterprise triage

1. Define a strict triage model contract and feature-owned prompt/stage after confirmed report admission.
2. Require priority inputs/rationale and allow `unassessed`; never force a severity when environmental evidence is absent.
3. If using CVSS, store vector components and source, and keep Base/Threat/Environmental distinct.
4. Generate proposed remediation and a validation plan as text only. Never apply patches or execute target tests.
5. Persist its own observation/cost and failure state without changing finding admission/CI finding count.

### Ticket 3.6 — Rebuild renderers and SARIF export

1. Make JSON canonical and derive Markdown/SARIF/CI views from it.
2. Render all evidence roles, verified controls, obligations, N/A reasons, incomplete work, triage, and limitations.
3. Escape headings, tables, code blocks, links, HTML, and terminal controls safely.
4. Remove/rename fake attack chains; add real chain contract only with separate evidence and verification.
5. Add complete golden fixtures and parse/validate SARIF against its schema/consumer smoke test.

## Files to modify

- finding/artifact/lineage/report/security/product specs
- `src/features/attack-planning/plan.schema.ts`
- `src/features/audit-execution/audit.schema.ts`
- `src/features/audit-execution/coverage-closure/**`
- `src/features/audit-execution/evidence-map/**`
- `src/features/audit-execution/investigation/**`
- `src/features/audit-execution/verification/**`
- `src/features/audit-execution/synthesis/findings.ts`
- `src/features/audit-execution/synthesis/identity.ts`
- `src/features/audit-execution/synthesis/chains.ts` (remove or rename)
- new `src/features/finding-triage/**`
- `src/features/audit-lineage/**`
- `src/features/audit-report/**`
- new SARIF exporter feature
- CLI/config/artifact store for protected-detail mode
- evaluation scorer/pair identity consumers
- generated schemas and colocated tests
- AGENTS/CLAUDE/implementation guidance and standalone docs

## Acceptance criteria

- No persisted confirmed finding has status `candidate`.
- Every enabled obligation has exactly one internally consistent closure.
- N/A is neutral, source/context-backed, crisp, and impossible without a reason.
- Missing business/deployment evidence is explicit incomplete/not-verifiable, never N/A/pass.
- Every confirmed finding includes all required evidence roles, verified control consideration, obligation provenance, and snapshot digests.
- Priority/fix can fail or remain unassessed without changing finding admission or audit completeness.
- Stable fingerprints survive pure line shifts and model wording changes in regression fixtures; ambiguous cases become unknown.
- Default JSON/CI artifacts contain no raw source/context/prompt/tool/model content.
- Protected detail is opt-in, permission-restricted, redacted/sanitized, and retention-addressable.
- Markdown renders finding-bearing fixtures in correct section order with every evidence item and no injection.
- SARIF validates and supports GitHub-compatible ingestion without line-only fingerprints or fake code flows.
- No object named attack chain is created from file co-location alone.

## Risks and mitigations

- **Reduced report immediacy without inline snippets:** renderer can resolve protected local references; keep locations and digests in canonical JSON.
- **Fingerprint ambiguity:** expose multiple partial fingerprints and unknown state; do not overmatch.
- **Priority inconsistency:** require explicit inputs/rationale, version the triage prompt, and evaluate separately from finding recall.
- **Context abuse:** keep it advisory and separately labelled; context can explain but not override contrary source.
- **Schema blast radius:** use one breaking version and remove legacy code rather than parallel shapes.

## Dependencies

- Requires Wave 1 exact snapshot/plan identity and Wave 2 canonical work/closure ledger.
- Triage prompt work coordinates with Wave 4 prompt architecture.
- SARIF release smoke coordinates with Wave 5 packaging.

## Out of scope

- Applying remediation patches.
- Proving runtime exploitability.
- Treating CVSS/priority as finding proof.
- Storing raw product prompts or source by default.
- Heuristic same-file attack chains.
