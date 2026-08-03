# Evaluation evidence and production release readiness

- **Priority:** P0 for quality claims; P1 for packaging
- **Effort:** XL
- **Risk:** High
- **Status:** Proposed

## Overview

Build an evaluation system that answers the two product questions separately and cheaply:

1. **Planning:** Did the AI generate the expected audit scenarios with useful, precise scope?
2. **Audit execution:** Given a deterministic reviewed plan, did the audit find the expected issues, reject patched/benign variants, handle N/A correctly, and close every obligation truthfully?

One provider run is the default development baseline. It produces quality/cost/trace evidence but no stability claim. Repeats are optional later experiments. After the evaluator is trustworthy and a blinded corpus is qualified, package and attest an installable CLI for enterprise pilots.

## Problem statement

The current scorer equates plan scenario quality with glob/path reachability and accepts a finding when any one required evidence role overlaps. Some field names contain different units. Matching is greedy/order-dependent, line-based pairing breaks on shifts, and unexpected outputs remain unadjudicated. Run artifacts do not bind all labels/scorer/protocol inputs or enforce trial/aggregate conservation. Provider CLI hard-requires five repetitions, so a basic scored baseline is unnecessarily expensive. The corpus has zero qualifying dual-reviewed real-world pairs and zero qualifying control families. Case IDs can expose CVE/CWE identities to the model. Published traces cannot explain where an expected issue was lost, while the user explicitly allows complete evaluation-only forensic capture except secrets.

The project also has no installable CLI, release pipeline, SBOM/provenance, dependency/license/security gates, or Git baseline.

## Proposed solution

### Evaluation profiles and claims

Keep profiles non-comparable and explicit:

| Profile | Provider planning | Plan input to audit | Measures |
| --- | --- | --- | --- |
| `planning-generated` | Yes | None | Generated scenario recall/precision, scope precision, answerability, duplicates, cost |
| `audit-reviewed-plan` | No | Frozen evaluator-authored plan | Finding recall/precision, localization, patched/benign FP, N/A/closure correctness, cost |
| `end-to-end-generated` | Yes | Its own generated plan | End-to-end outcome only; diagnostic attribution against the first two profiles |

Each profile supports:

- `diagnostic-single`: exactly one repetition allowed and default for development. Quality metrics are valid for that frozen sample; Jaccard/stability/confidence fields are `null` and the artifact cannot claim reliability.
- `reliability`: explicit operator opt-in with a declared repetition count and cost ceiling after the corpus/profile is qualified. Never run by default CI and never require five merely to get a score.

Do not merge or compare profile baselines. One run per selected case/variant is enough for initial structural work, as explicitly required by the project owner.

### Planning measurement

Retain current deterministic path reachability but rename it `structuralScopeReachability`; it is diagnostic only.

Add a semantic one-to-one scenario adjudication contract:

- Answer keys define stable scenario IDs, concise risk objective, applicability, evidence requirements, relevant paths, and expected finding IDs.
- After provider sessions close, a blinded evaluator maps generated vector/obligation IDs to zero or one expected scenario and marks extra valid, duplicate, irrelevant, or unanswerable scenarios.
- Canonical production-quality labels require human adjudication by independent source-only reviewers. An optional evaluator-model judge may assist triage only after it is calibrated against those labels and is always labelled judge-assisted/non-ground-truth.
- Metrics: expected scenario count, matched scenario count, missed count, extra-valid count, irrelevant count, duplicate count, scenario recall, precision (when exhaustive), F1, scope precision/recall, and answerability rate.
- Broad `**/*` cannot earn semantic credit without a matching scenario objective/evidence contract and is penalized in scope precision when unnecessary.

The headline becomes: `generated X/Y expected audit scenarios`, with extras and scope quality separately reported.

### Finding measurement

- Expected findings have stable evaluator-owned IDs, source-only root-cause rubric, all mandatory evidence roles, accepted vulnerable ranges, and variant-specific patched ranges/bindings.
- Build a deterministic bipartite graph where an output can match an expected finding only when every applicable mandatory role overlaps an accepted range and the vector/obligation constraints are satisfied.
- Use deterministic maximum matching, not first-match greedy order.
- Project the expected finding ID into evaluator results; use that identity to measure vulnerable→patched persistence even after line shifts.
- Separate `known-range detection`, `full localization`, and `semantic adjudication`. A finding at the right line with the wrong claim is not a semantic TP; a correct alternative issue outside known ranges is unadjudicated until reviewed.
- Targeted labels can report recall and unadjudicated outputs, not precision. Exhaustive labels can report precision/F1.
- Patched matches, benign false positives, adjudicated unexpected false positives, valid alternative findings, and unadjudicated findings are separate counts.
- N/A scoring measures applicable vs not-applicable decisions and reason/evidence sufficiency. Incomplete is never counted as pass or N/A.

Headline: `found X/Y expected issues`, `missed N`, `patched/benign false positives N`, `unadjudicated N`, plus localization and closure truth.

### Artifact identity and invariants

Bind every checkpoint/run/baseline/comparison to canonical digests for:

- corpus manifest and every selected source snapshot;
- every answer key and reviewed plan;
- human adjudication pack/readiness decision;
- scorer protocol and matching algorithm;
- artifact schema/renderer;
- product prompt/tool/workflow protocol;
- provider/model/verification route;
- price catalogue version/digest and cost guard settings;
- profile, measurement mode, case selector, split, and repetition count.

Schema refinements validate the exact expected case×variant×repetition matrix, unique trial identities, status/score compatibility, profile-specific fields, aggregate recomputation, gate state, and safety violations. Comparisons recompute from validated trials and reject every identity mismatch. Old incompatible artifacts are retired, not translated under the same schema version.

### Blinding and answer-key isolation

- Model-facing target display names are opaque random/stable trial aliases; never case IDs, CVEs, CWEs, dataset names, vulnerability labels, or paired-variant hints.
- Planning/audit sessions receive only their allowed source/context/plan. Answer keys, scorer code, real case ID, patched pair, and adjudication remain outside their tool root and prompt.
- Add canary/leakage tests that fail before provider dispatch if a forbidden identifier appears in prompt/tool scope.

### Evaluation-only forensic mode

Implement an opt-in `--forensic-trace true` available only to evaluation commands and rejected by product CLI.

The private ignored trace pack may contain, per trial/stage/request:

- exact system/user prompts after secret/API-token filtering;
- exact normalized model output and schema-validation issues;
- tool calls, arguments, results, operation IDs, durations, bytes, and errors;
- work-ledger transitions, recovery partitions/reducers, checkpoint reuse, and admission decisions;
- token/cache/reasoning usage and catalogue cost;
- evaluator match/adjudication steps after the provider session closes.

Rules:

- API keys, authorization headers, provider credentials, private holdout answer keys before scoring, and environment secrets are always forbidden.
- Trace storage is isolated from target/context/provider tools, ignored by Git, restrictive-permission, versioned, checksumed, and retention-controlled.
- Published run JSON/Markdown remains source-free and links only by trace-pack digest/path on the local machine.
- A separate source-free lineage follows each expected scenario/finding through plan match, map, coverage, discovery, grounding, verification, admission, and score so failures can be diagnosed without opening raw traces first.

### Corpus program

#### Development corpus

Use a mixed set of synthetic and real-world pairs:

- NIST SARD/Juliet and OWASP Benchmark for controlled positive/negative coverage.
- GitHub CodeQL query tests as candidate language/control examples, subject to source/label review and licensing.
- Pinned real-world vulnerable/fixed commits from advisories/CVEs and project security patches.
- Enterprise-style hand-authored context packs testing tenancy, authorization, PII/secret handling, deployment assumptions, logging, retention, and N/A.

Balance languages (at minimum Go, Python, Java/Kotlin, C/C++, C#, JavaScript/TypeScript, PHP/Ruby, Rust where source pairs exist), difficulty, multi-file depth, control families, vulnerable/patched/benign, context/no-context, and known/unknown extension.

#### Qualification

- Each qualifying real-world pair has two independent source-only human reviews that agree on static applicability, root cause, mandatory evidence roles/ranges, expected scenarios, patched negative, control families, and label coverage.
- Disagreements are resolved and recorded by a third adjudicator or remain provisional.
- Repository/project split prevents train/tune leakage between development and holdout.
- Freeze a small blinded one-run slice first. Do not wait for a 100-case corpus to repair scoring.
- Pilot target: 30 dual-reviewed real-world pairs with patched negatives, multiple languages/control families.
- Reliability target: 100 qualified pairs only after pilot metrics and acquisition process are trustworthy.

Private local research and redistribution are separate policies. A source pair may be eligible for private local evaluation with provenance/rights metadata even if it cannot be published. Export/publication enforces redistribution rights. License status never fabricates human adjudication or readiness.

### Cost-efficient workflow

1. Run deterministic schema/scorer/stage tests for every code change.
2. Run one planning-only diagnostic on one selected vulnerable case when planner behavior changes.
3. Run one reviewed-plan vulnerable+patched pair when audit behavior changes.
4. Resume exact checkpoints after interruption; do not repeat completed calls.
5. Use explicit cost ceiling and catalogue pricing. Report known estimated cost, unknown failed-dispatch cost, calls/tokens/cache by stage.
6. Do not run five repeats during development. Run optional repeated reliability only for a frozen candidate release/model/prompt/corpus.

### Production distribution and release

Choose one supported enterprise distribution in specs—recommended first option: a versioned private npm-compatible CLI package for Bun, with an optional signed standalone Bun artifact after compatibility proof.

Required release properties:

- `bin` entrypoint and package exports/files; no raw workspace-source requirement.
- exact supported Bun/OS/architecture matrix and provider adapter compatibility.
- dynamic optional provider loading; offline report/lineage works with no adapters.
- reproducible/frozen install and packaged CLI smoke tests.
- checksums, SBOM, build provenance/attestation, changelog, rollback instructions.
- LICENSE decision, SECURITY.md/private disclosure process, CONTRIBUTING, CODEOWNERS, support/maturity statement.
- CI actions pinned to full SHAs; dependency vulnerability/license review, secret scan, schema/spec/doc drift, package-content audit, and E2E.
- release does not include `.env`, evaluation source/answer keys, forensic traces, output/checkpoints, private corpus, or dev secrets.

Current TypeScript 7.0.2, Zod 4.4.3, and Biome 2.5.6 match npm latest as of this review. Preserve automated freshness checks but prioritize protocol compatibility, particularly Purista Harness/provider adapters.

## Implementation steps

### Ticket 5.1 — Replace evaluation profiles and one-run gate

1. Update evaluation specs/guidance to define the three profiles and `diagnostic-single` vs `reliability` claims.
2. Remove minimum-five parsing rule from `run-provider.ts`; require exactly one by default and allow explicit repeats.
3. Make reliability/Jaccard/confidence null for one repetition and prevent reliability wording/gates.
4. Add profile identity to every checkpoint/run/baseline/comparison and reject cross-profile comparisons.

### Ticket 5.2 — Implement semantic plan scoring and correct finding matching

1. Extend evaluator-only answer-key schemas with semantic scenario rubric and variant-specific expected finding bindings.
2. Rename current path metric to structural scope reachability.
3. Implement blind one-to-one scenario adjudication import/workflow and scenario metrics.
4. Replace greedy `some-role` matching with maximum bipartite matching requiring all applicable roles.
5. Correct every mislabeled denominator/field; add adversarial table tests for overlap order, N/A roles, multiple findings per path, broad globs, shifted patches, targeted/exhaustive labels, and valid alternatives.

### Ticket 5.3 — Freeze evaluator identity and artifact conservation

1. Add canonical digests for answer keys, plans, scorer/artifact/pricing protocols.
2. Add run/trial cross-field refinements and aggregate recomputation.
3. Retire incompatible schema-v4 artifacts into a clearly historical directory or delete ignored generated runs after preserving only an explicit source-free note; do not make them comparable.
4. Add tamper, truncation, digest drift, duplicate trial, status-score mismatch, and comparison mismatch tests.
5. Write run checksums/content manifest promised by docs.

### Ticket 5.4 — Add model blinding and forensic trace packs

1. Replace model-facing case display names with opaque aliases.
2. Add forbidden-token canaries and tool-root isolation tests.
3. Implement evaluation-only forensic logger/sink with strict command gating, secret filtering, schema/version, checksums, permissions, and retention metadata.
4. Add expected-scenario/finding source-free lineage and complete, non-truncated sidecars for request/cost/tool hotspots.
5. Test that product commands always use no-content telemetry and cannot enable forensic mode.

### Ticket 5.5 — Qualify a first blinded corpus slice

1. Define reviewer instructions and adjudication schema separate from product agents.
2. Acquire a small language/control-balanced vulnerable/patched set from already-local or approved sources; store source, context, answer keys, reviewed plans, and adjudication separately.
3. Permit private local packs based on provenance/rights metadata while keeping publication gates strict.
4. Blind IDs, validate checksums, complete two independent reviews, resolve disagreements, and freeze digests before model use.
5. Run corpus readiness and require non-zero qualifying pairs/control families before accuracy claims.

### Ticket 5.6 — Establish the first truthful provider baseline

1. Select one blinded qualifying pair.
2. Run one `planning-generated` trial and report `generated X/Y expected scenarios`, extras, duplicates, scope precision, cost/tokens/tools.
3. Run one `audit-reviewed-plan` trial for vulnerable and patched variants and report `found X/Y expected issues`, misses, patched FP, N/A/incomplete, localization, cost/tokens/tools.
4. Adjudicate every unexpected output after sessions close.
5. Diagnose structural loss from forensic/source-free lineage and create targeted tickets. Do not change models until structural failures are exhausted.

### Ticket 5.7 — Package and secure the release

1. Create the baseline Git commit before implementation waves, then establish changelog/release versioning.
2. Add `bin`/build/package files and dynamic provider imports; test package install in an empty directory.
3. Add SECURITY.md, license decision, contributing/support, CODEOWNERS, and release docs.
4. Pin CI actions to SHAs and add dependency/license/vulnerability/secret/SBOM/provenance/package-content gates.
5. Sign/checksum release artifacts and run plan→audit→report/lineage E2E against fake provider and representative repositories.
6. Conduct a small enterprise pilot; mark production only after P0 closure and baseline acceptance.

### Ticket 5.8 — Add artifact retention operations

1. Add source-free artifact inventory and dry-run prune commands scoped by run, age, data class, and references.
2. Preserve artifacts referenced by retained reports/baselines and refuse unsafe/broad targets.
3. Default to no automatic deletion; document compliance-oriented policies.
4. Add evaluation run garbage collection for obsolete traces/checkpoints and retain only explicitly promoted source-free baseline summaries.

## Files to modify

- `specs/08-evaluation/**`
- release/supply-chain/operations specs
- `src/features/evaluation/corpus.schema.ts`
- `src/features/evaluation/corpus.ts`
- `src/features/evaluation/real-world-scorer.ts`
- `src/features/evaluation/real-world-runner.ts`
- `src/features/evaluation/real-world-artifacts.ts`
- `src/features/evaluation/real-world-report.ts`
- `src/features/evaluation/run-provider.ts`
- `src/features/evaluation/run-provider-smoke.ts`
- `src/features/evaluation/comparison.ts`
- `src/features/evaluation/importer.ts`
- new adjudication/forensic/lineage feature modules and colocated tests
- `evaluation/corpora/**`, readiness schemas, and reviewer guidance
- `src/platform/harness/provider.ts`
- `src/cli/main.ts`
- `package.json`, `bun.lock`, release/build scripts
- `.github/workflows/**` and dependency update configuration
- SECURITY/LICENSE/CONTRIBUTING/CHANGELOG/CODEOWNERS files
- AGENTS/CLAUDE/implementation guidance and standalone `docs/07-evaluation/**`, setup, operations, and reference docs

## Acceptance criteria

- `--repetitions 1` produces a scored diagnostic artifact; stability/Jaccard/reliability remain null/unclaimed.
- Planning headline is semantic `X/Y expected scenarios`, not path coverage; broad globs alone cannot score semantic recall.
- Findings match only with all applicable mandatory evidence roles and deterministic one-to-one matching.
- Vulnerable/patched persistence uses expected finding IDs and survives harmless line shifts.
- Targeted labels never claim precision; exhaustive labels separate patched, benign, adjudicated FP, valid alternatives, and unadjudicated output.
- Every run artifact binds all source/label/plan/scorer/protocol/pricing identities and rejects tampering/truncation/inconsistent aggregates.
- No model-visible prompt/path/display name exposes case ID, CVE/CWE, answer key, dataset label, or paired variant.
- Evaluation-only forensic traces reproduce stage/tool/recovery/admission flow while containing no API tokens/secrets; product mode cannot capture content.
- Corpus readiness has a frozen non-zero dual-reviewed real-world paired slice before any accuracy claim.
- One baseline reports exact plan and finding numerator/denominator, N/A/incomplete, tokens/calls/cache/cost, and limitations.
- An empty-directory install can run plan/audit/report/lineage using only selected optional provider adapter; offline commands need none.
- Release emits checksums, SBOM, provenance, package-content report, and passes pinned CI/security gates.

## Risks and mitigations

- **Human adjudication cost:** start with a small frozen slice and use judge assistance only for triage after calibration; ground truth remains human.
- **Forensic trace leakage:** evaluation-only command gate, minimization, secret canaries, restrictive permissions, checksums, and retention. Never copy traces into published artifacts.
- **Historical metric discontinuity:** use new schema/scorer versions and explicitly prohibit comparison to old metrics.
- **Corpus license constraints:** separate private research from publication and retain provenance; do not weaken redistribution gates.
- **Release complexity:** ship one supported local CLI distribution first, then expand formats after compatibility evidence.

## Dependencies

- Requires Waves 1-4 contracts and behavior to be stable enough to measure.
- Requires two independent source-only reviewers for qualifying corpus cases.
- Requires an authoritative check of current Purista Harness/provider adapter releases and loop behavior.

## Out of scope

- Mandatory five-run development evaluations.
- Claiming statistical reliability from one run.
- Letting answer keys or benchmark identities influence product agents.
- Treating an evaluator-model judge as ground truth without calibration/adjudication.
- Public redistribution of source without rights.
- Cloud service deployment; first production target is a local/CI CLI.
