# External evaluation corpus research

Research date: 2026-07-29. This record evaluates datasets for a **read-only source-review** product. It does not authorize downloading a corpus at runtime, executing target projects, running exploits, or adding a dataset to default CI.

## Finding

The checked-in corpus now has two deliberately separate layers: a synthetic, deterministic 13-case contract pack spanning eleven categories and multiple language labels; and a four-case source-only seed pack: one real-world OpenSSF pair, two synthetic controls from OWASP Benchmark Java and NIST SARD Juliet, and one semantic-regression pair from CodeQL query help. Neither layer is evidence of configured-provider effectiveness. The seed proves provenance validation, paired-source mounting, answer-key isolation, scoring, reporting, and source-free admission-funnel diagnostics; it must not be used to claim planner reliability, finding recall, false-positive control, provider comparison, or production readiness.

The product is language-agnostic: TypeScript/Bun is the reviewer implementation stack, not a target-language constraint. The recommended first external corpus is **OpenSSF CVE Benchmark** because it offers the quickest real JavaScript/TypeScript measurement path, not because those are the only supported target languages. It uses historical real-world CVEs, includes both vulnerable and patched versions, and explicitly measures missed vulnerabilities and findings that remain after a patch. The OpenSSF announcement describes 218 historical JavaScript/TypeScript CVEs and the paired vulnerable/patched evaluation model. [OpenSSF announcement](https://openssf.org/blog/2020/12/09/introducing-the-openssf-cve-benchmark/)

The real-world seed is imported under pinned revisions/checksums and its source-inclusion decisions are recorded in its manifest. The product has not yet imported the 30-pair OpenSSF pilot or a private holdout; neither is downloaded at runtime.

## 2026-07-30 source refresh and acquisition evidence

The pinned OpenSSF checkout at `91c59fd54b2b768c0f310bb0027d2ac59cdf74d4` was independently checked locally with `bun run eval:candidates --source <checkout>`. All 30/30 registry records matched a regular local metadata file, its SHA-256 digest, published status, repository URL, and vulnerable/patched revision. The registry is therefore a verified **metadata acquisition queue**, not a corpus: all 30 entries have an `unverified` upstream source-license status, while acquisition and adjudication state live only in their separate source-pair workspace and corpus answer-key artifacts. No candidate was selected using provider output, and this validation did not open a candidate repository, run a target, or create an answer key.

The upstream OpenSSF project continues to describe more than 200 real JavaScript/TypeScript CVEs and explicitly evaluates both vulnerable and patched revisions; that makes it the appropriate first queue for the JavaScript/TypeScript slice. [OpenSSF repository](https://github.com/ossf-cve-benchmark/ossf-cve-benchmark)

The current CWE-Bench-Java repository describes 120 Java CVEs across path traversal, OS-command injection, cross-site scripting, and code injection. Twelve repository-distinct entries from its pinned `project_info.csv` now form a metadata-only queue; their buggy/fixed commits are provenance leads, not labels or answer keys. Its fetch/patch/build scripts remain excluded: the product may consume only already-local metadata and manually reconstructed source snapshots. [CWE-Bench-Java repository](https://github.com/iris-sast/cwe-bench-java)

PrimeVul remains a complementary C/C++ metadata reservoir: it publishes commit, project, vulnerability, and file metadata, but its labels and included file content must not be imported as answer keys or target source. Its paired-sample design is useful for candidate discovery only. [PrimeVul repository](https://github.com/DLVulDet/PrimeVul)

### Curation sequence after this refresh

1. Select no more than one OpenSSF record per repository from the verified 30-record queue, without consulting provider results.
2. Obtain vulnerable and patched snapshots outside the product; verify both immutable revisions and the upstream project license before copying anything into a local pack.
3. Run two independent human source-only reviews, including a vulnerable finding and the patched negative, then enter a schema-v4 answer key only when the judgments—including the exact source-bound planning scenarios and finding-label coverage—match.
4. Independently form the Java and C/C++ queues from CWE-Bench-Java and PrimeVul metadata. Their dataset labels/patches are locators, not category, localization, or answer-key truth.
5. Reserve at least one repository-disjoint, privately curated source pair for the holdout. It must not be opened during prompt design or configuration selection.

This preserves language diversity without changing the reviewed-target path: acquisition metadata, reviewer artifacts, and corpus source snapshots remain evaluator-only and cannot become model instructions or deterministic security rules.

## Dataset assessment

| Dataset | Fit | Evidence | Decision |
| --- | --- | --- | --- |
| OpenSSF CVE Benchmark | Best first corpus for v1; real JavaScript/TypeScript CVEs with vulnerable and patched code. | 218 historical CVEs; intended for SAST effectiveness and patched-code false-positive measurement. [OpenSSF](https://openssf.org/blog/2020/12/09/introducing-the-openssf-cve-benchmark/) | Adopt through an offline, pinned importer after license/provenance verification. |
| SecBench.js | Strong complementary JavaScript corpus with real vulnerabilities, fixes, and executable validation. | ICSE artifact describes an executable benchmark for server-side JavaScript. [ICSE artifact](https://conf.researchr.org/details/icse-2023/icse-2023-artifact-evaluation/51/SecBench-js-An-Executable-Security-Benchmark-Suite-for-Server-Side-JavaScript) | Use source and labels only; do not execute its exploits or applications. Confirm release location and license before import. |
| CVEfixes | Large, multi-language reservoir for later curation. | Pinned v1.0.8 source revision `9283b50b3f04e3c5b0a17fc419ab0feea23fc438` documents its separate CC BY 4.0 relational database (the collection code is MIT): CVE, repository URL, fixing commit, parent/source-before, source-after, file language, and CWE linkage. It reports 11,873 CVEs, 12,107 fixing commits, 4,249 projects, and 272 CWEs through 23 July 2024. [CVEfixes](https://github.com/secureIT-project/CVEfixes) | Curate sampled repository-level cases; do not treat automated commit labels, database records, or either dataset/collection-code license as permission to copy any selected upstream source. |
| DiverseVul | Large commit/repository metadata reservoir for sampling repository-disjoint candidates. | Its released metadata identifies repository and commit URLs for 7,512 commits; its paper warns that generalization and false-positive control remain hard. [repository](https://github.com/wagner-group/diversevul), [paper](https://arxiv.org/abs/2304.00409) | Use metadata only to find candidates. Reconstruct each source pair from the upstream repository and require the same provenance, licensing, and dual-review process as any other case. |
| PrimeVul | Useful C/C++ realism and paired-sample research. | About 7k vulnerable and 229k benign real-world C/C++ functions across 140+ CWEs. [PrimeVul](https://github.com/DLVulDet/PrimeVul) | Add a C/C++ case family after manual source-only adjudication. |
| MegaVul | Potential C/C++ and Java candidate reservoir, not a source pack. | It collects vulnerability-related changes from Git repositories and is released under GPL-3.0. [repository](https://github.com/icyrockton/megavul), [paper](https://arxiv.org/abs/2406.12415) | Keep it metadata-only until each selected upstream project license and redistribution decision have been reviewed; do not copy its release wholesale into the corpus. |
| NIST SARD / Juliet | Broad public synthetic conformance testing, including good/bad variants. | SARD documents almost 200k test programs; Juliet C/C++ 1.3 has 64,099 cases across 118 CWEs and is CC0/public-domain material. [SARD](https://www.nist.gov/itl/csd/secure-systems-and-applications/samate/software-assurance-reference-dataset-sard), [Juliet](https://samate.nist.gov/SARD/test-suites/112?limit=50) | Use as C/C++ synthetic taxonomy regression; never as the primary real-world score. |
| OWASP Benchmark Java | Mature scored SAST benchmark with expected-result labels. | Thousands of Java cases and an expected-results file that records CWE and true/false status. [OWASP](https://owasp.org/www-project-benchmark/), [repository](https://github.com/OWASP-Benchmark/BenchmarkJava) | Add a Java case family with static-only scoring. |
| CWE-Bench-Java | Best next real Java candidate set. | Its maintainers describe 120 CVEs across path traversal, OS-command injection, cross-site scripting, and code injection; seed metadata identifies buggy/fix commits and fixed files/functions. It provides fetch/patch/build scripts, but those scripts are excluded from this product. [CWE-Bench-Java](https://github.com/iris-sast/cwe-bench-java) | Use seed metadata only as a locator; reconstruct source snapshots from each upstream repository, review each source license, and never run fetch/build scripts or treat the upstream labels as an answer key. |
| SEC-bench | Agent-oriented real-world benchmark, but materially out of v1 scope. | Requires Docker and recommends more than 200 GB; includes PoC and patch assessment. [SEC-bench](https://github.com/SEC-bench/SEC-bench) | Do not integrate: its execution/PoC model conflicts with the product’s static, no-attack boundary. |

## Corpus design decision

The evaluation corpus has three separate tracks. Scores from one track must never be presented as scores from another.

| Track | Purpose | Source | Required measurement |
| --- | --- | --- | --- |
| `contract` | Prevent product/harness regressions. | Checked-in small fixtures. | Schema, jail, approval, answer-key isolation, and deterministic output. |
| `real-js-ts` | Measure source-review usefulness on historical vulnerabilities. | Offline imported OpenSSF CVE Benchmark cases; later vetted SecBench.js cases. | Vulnerable recall, patched-code false-positive rate, evidence localization, priority agreement, plan coverage, and repeatability. |
| `private-holdout` | Limit public-benchmark/model-contamination bias. | Privately licensed or internally authored, manually adjudicated pairs. | Same metrics as `real-js-ts`; release confidence is based primarily on this track. |

The corpus may copy only code and metadata whose license permits the intended local storage and CI use. Default CI receives a small reviewed subset, never a runtime download. Larger externally sourced packs are installed by an explicit offline importer that pins upstream repository/tag or commit, retrieval date, content SHA-256, license, attribution, case transformation, and removal policy.

## Acquisition order and anti-contamination controls

The recommended acquisition order is deliberately based on source provenance and reviewability, not whichever corpus produces the best measured score.

| Order | Candidate source | Role | Admission rule |
| ---: | --- | --- | --- |
| 1 | OpenSSF CVE Benchmark | First real JavaScript/TypeScript paired pilot. | Select repository-disjoint CVE fixes; stage only locally; validate each upstream project license and dual-review the source claim and patched negative. |
| 2 | CWE-Bench-Java | First real Java repository family. | Use buggy/fix metadata only as a locator; reviewers establish static-review applicability and exact evidence locations independently. |
| 3 | CVEfixes | Multi-language reservoir for the remaining control families. | Automated CVE/commit labels are candidates, never answer keys. Reconstruct both revisions from the upstream repository before review. |
| 4 | DiverseVul, PrimeVul, MegaVul | Coverage expansion and private-holdout candidate discovery. | Preserve repository-disjoint splits; do not import a corpus release or use its train/test split as the product split without a recorded contamination review. |

## Next curation batch, decided before provider measurement

The evidence supports a mixed first batch, rather than a 30-case JavaScript-only shortcut:

| Source | Batch role | Selection frame | Non-negotiable review check |
| --- | --- | --- | --- |
| OpenSSF CVE Benchmark | 10 JavaScript/TypeScript real pairs | Repository-disjoint historical pairs selected across the missing control families where source-only evidence is intelligible. | Confirm the project license and independently label the vulnerable evidence and patched negative. |
| CWE-Bench-Java | 10 Java real pairs | One or two candidates per repository from the four published CWE families, excluding cases whose source-only claim depends on a running environment. | Obtain pinned upstream snapshots without executing its tooling; establish static applicability and exact source locations independently. |
| CVEfixes | 10 Go, Python, PHP, C/C++, or Java pairs | Fill missing language/control-family cells only after an upstream repository and paired revisions are independently reconstructed. | Treat the database as a locator only; verify the actual revision, source license, and both human labels. |

This batch targets the 30-project pilot while preserving language diversity and control-family balance. It is a candidate-selection protocol, not a dataset claim: no case is counted until its local pack validates and two independent reviews are recorded.

No source package may be selected because an earlier provider run already succeeds on it. Candidate selection must occur before a provider measurement, use source-independent sampling criteria (language family, control family, difficulty, repository cap), and record rejected candidates and reason codes. Public benchmark cases remain development/test material. A private holdout is separately curated, withheld from prompt/example authoring, and opened only by the evaluator after a frozen configuration is selected.

## Required case shape

Each imported vulnerability requires a vulnerable snapshot and a patched snapshot from the same repository lineage. A case is invalid unless an adjudicator records all required fields:

| Field | Requirement |
| --- | --- |
| Provenance | Dataset, upstream URL, repository, immutable commit/tag, retrieval date, license, checksums. |
| Labels | CVE/GHSA when available, normalized CWE/category, affected paths, changed hunks, expected priority band, and adjudication notes. |
| Pairing | Vulnerable and patched snapshots; generated target views must exclude the patch and answer key. |
| Scope | Files allowed to the reviewer and optional curated Markdown context, each with its own digest. |
| Split | Repository-disjoint `development`, `test`, or `private-holdout`; no project can appear in more than one split. |
| Review | Two independent labels for initial imports; disagreements are resolved and recorded before a case becomes a gate. |

Raw patch hunks are an initial localization anchor, not proof that every changed line is vulnerable. Manual adjudication must identify the source evidence expected from the reviewer and explicitly mark cases unsuitable for static, source-only review.

## Measuring planning and findings separately

Finding quality is one-to-one matched by category, priority band, and source location. For every vulnerable/patched pair report:

- vulnerable recall, precision, F1, and critical/high recall;
- patched-code false-positive rate, including a paired persistence rate for a finding that remains on the patch;
- evidence localization accuracy against adjudicated path/line ranges;
- priority agreement (exact and within one severity band);
- invalid-output, unsupported, and coverage-incomplete rates.

Planning is scored before audit execution. Each case contains trusted expected vector categories and relevant path globs created by adjudication. A plan is measured for category recall, relevant-path coverage, unnecessary-vector count, human approval/rework rate, and whether its eventual audit missed a labeled issue because the required vector was absent or disabled. A generic plan that selects every category receives low precision and does not earn a planning-quality pass.

For a configured provider/model, run the identical reviewed target view at least five times outside default CI. Report medians and ranges for plan category recall, finding recall/precision, pair persistence rate, cost, latency, tool-call counts, invalid outputs, and Jaccard agreement of normalized plan vectors and findings. A single run is a smoke result, not a reliability claim.

## Initial import pilot and gates

The next offline OpenSSF pilot must contain 30 repository-disjoint JavaScript/TypeScript CVE pairs after manual review. It must cover at least injection, authorization/authentication, sensitive data, path traversal, deserialization, crypto, and supply-chain/dependency cases where the source-only boundary can make a useful judgment. If a category cannot be obtained or accurately labeled, it is represented as a documented gap rather than fabricated data.

The pilot establishes a baseline; it does **not** set a release claim. Once the corpus reaches 100 repository-disjoint real pairs and at least 25 manually adjudicated patched negative cases, the configured-provider gate may require:

- critical/high vulnerable-pair recall >= 0.80;
- patched-pair false-positive rate <= 0.20;
- evidence localization accuracy >= 0.75 among matched findings;
- zero answer-key exposure, target execution, target mutation, or network-tool policy violations;
- no provider configuration claim without five-run reliability results and a private-holdout report.

Thresholds are provisional baselines pending pilot data; they must be revised only with a dated adjudication and regression note, never after observing a single failing run.

## Exclusions

The evaluator does not start applications, execute exploit code, make target network calls, use PoCs, or validate reachability. SecBench.js and SEC-bench execution assets are explicitly excluded from the target view. This preserves the product’s defensive static-review boundary while still allowing source snapshots, patches, advisories, and manually curated context to be used as offline evidence.

## Current evidence boundary and remaining data gap

The evaluator loads strict disk-backed packs, verifies provenance/checksums, mounts one source-only variant in a jail, runs the normal Purista planner/auditor path, scores plan coverage separately from findings, records repeated provider trials, and rejects duplicate project ids across splits. The evaluator is therefore ready for an offline curated pilot.

The remaining blocker for any configured-provider reliability claim is data, not harness mechanics: curate the 30-pair OpenSSF pilot with dual adjudication, then grow to 100 repository-disjoint real pairs, 25 manually adjudicated patched negatives, and a private holdout. The deterministic `eval:corpus:readiness` artifact makes these counts visible per pack and excludes synthetic and semantic-regression cases from the real-world thresholds. Do not run or publish a provider benchmark as a reliability result before that corpus evidence exists.
