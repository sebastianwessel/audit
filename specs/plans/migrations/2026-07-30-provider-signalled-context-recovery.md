# Provider-signalled context recovery

Status: implementation-authoritative change. This migration repairs the source-access and model-recovery behavior that previously used arbitrary file, line, search-result, return-size, source-package, and model-tool-call ceilings.

## Decision and rationale

The reviewer must not silently omit eligible source because an implementation guessed a context or response size. A target repository may contain an arbitrary mix of languages, unknown extensions, large regular UTF-8 files, long lines, or many matches. Those facts are not evidence-quality defects and must not be converted into an unreviewed portion of the approved scope by a fixed product limit.

The only valid trigger for model-context partitioning is a normalized Purista `ModelError` whose sanitized metadata has `reason: context_length_exceeded`. Token estimates, character estimates, language labels, file extensions, directory names, match counts, source size, and provider/model names must not trigger pre-emptive partitioning or omission. Normal provider retry remains separate from this recovery.

Host cancellation, an explicitly configured time deadline, invalid UTF-8, a non-regular file, traversal, a symlink escape, or a provider failure other than the normalized context-window error may still end work. The resulting vector is explicitly incomplete or failed; it is never represented as a clean review. A byte-bounded *single I/O transaction* is permitted only when the adapter immediately continues from its exact cursor until the requested range is complete. It is not a target-file maximum and cannot create a coverage limitation by itself.

## CAP-075 end-to-end behavior

Actor: a CLI or evaluation run that invokes planning or an approved audit. Owner: `review-workflow/runtime` for shared recovery orchestration, individual stage modules for their typed invocation/reduction adapter, `target-inventory` for complete source enumeration, and `platform/filesystem` for cursor-safe reads/searches.

1. Inventory traverses every eligible regular UTF-8 target file and every allowlisted context document without a product file-count, file-size, line-count, or source-content cap. It computes a complete deterministic inventory and fingerprint incrementally. A source is never omitted merely because it is large or its extension is unknown.
2. The normal model invocation receives the original approved stage scope. It is not split, shrunk, truncated, or selected by a token estimate.
3. On the first normalized `context_length_exceeded`, the shared recovery owner creates stable work units from the rejected stage's already-approved scope: lexicographically sorted source paths; then exact source line ranges split at a source newline; then the already applicable advisory context documents, and finally one context body at a Markdown newline. It retries the resulting children in stable order and repeats only on the same normalized error. Context chunks are in-memory input views with a digest of their exact body; they do not become target files, tools, artifacts, or model permissions. Child tools remain read-only and cannot address another vector, root, context file, answer key, or live target.
4. A child output is retained only in process memory until its stage-specific reducer has produced a canonical validated result. Prompts, raw child outputs, source text, paths, tool arguments/results, and provider bodies are never checkpointed or logged. Existing canonical map, posture, grounding, and terminal checkpoints remain the only durable recovery boundaries.
5. The shared ledger records the ordinary provider observations plus the stable content-free recovered error code and recovery outcome/count. It must not record partition paths, ranges, prompt sizes, source sizes, or provider error bodies. A resumed run reuses the latest matching canonical predecessor; it never restarts completed predecessor phases because a later stage needed context recovery.
6. If recursive partitioning reaches one indivisible source range and applicable context body and the provider still returns `context_length_exceeded`, that stage has no silent fallback. It returns a stable context-overflow failure and the vector records incomplete coverage. No finding is admitted from that stage.

## Stage-specific reduction rules

The shared mechanism owns error recognition, partition traversal, session lifecycle, tool confinement, request observation, and source-free recovery telemetry. It does not interpret security semantics. Each stage owns one strict reduction adapter; no stage may invent a second generic recovery loop.

| Stage | Child work unit | Valid reduction | Non-lossless condition |
| --- | --- | --- | --- |
| planning | inventory path/range partition | Combine only exact non-duplicate draft vectors, then keep the draft plan human-reviewable. | A non-identical vector-id collision is a planning failure, not a guessed deduplication. |
| evidence mapping | source path/range partition | Union canonical facts after deterministic partition-qualified fact-id projection; union unanswered obligations and limitations. | Invalid/duplicate conflicting fact identity fails the map; no fact is discarded. |
| source posture | source path/range partition | One assessment per question: preserve a unanimous directional conclusion; otherwise return `inconclusive` with the child limitations. | Directional conclusions that cannot be reconciled become explicit incomplete coverage, not an automatic security decision. |
| discovery | source path/range partition | Union valid seeds; merge closures by their existing closure algebra (`incomplete` dominates, then `candidate-raised`, then unanimous `no-source-backed-candidate`). | Invalid duplicate seed identity fails discovery. |
| candidate grounding | The unchanged root first; after overflow, only a source path/range child that wholly contains every map fact and posture assessment bound to a seed may own that seed. A child with no owned seed performs no model dispatch and returns an explicit empty canonical outcome. Context-only partitioning is not permitted because a grounding decision has no lossless context merger. | Reassemble exactly one result from exactly one owning child per original seed. | A seed that crosses a child boundary, any duplicate or missing seed outcome, a failed child, or a context-only overflow produces no canonical grounding draft. |
| verification/countercheck | one hypothesis | Record the normalized root overflow in the exact candidate-bound phase checkpoint; do not dispatch child decisions because no lossless decision reducer exists. A verifier decision is admitted only when one complete schema-valid decision covers the original hypothesis. | Return `incomplete` with the context-overflow limitation; an exact retry makes no provider call, while a changed binding starts a new root attempt. |

No reduction rule may infer a vulnerability, data flow, exploitability, source control effectiveness, priority, language semantics, or a finding. The ordinary map, posture, grounding, integrity, verifier, and synthesis boundaries remain unchanged.

## Source tools and inventory contract

`repo_list`, `repo_read`, and `repo_grep` remain capability-limited by the approved scope and jail. They do not have a fixed list entry, file, line, grep-file, grep-byte, match, line-character, pattern-return, or aggregate model-tool-call limit that can omit source. The tool contract uses explicit continuation cursors/ranges only when a caller asks to resume an incomplete transport transaction; the adapter must automatically complete inventory/internal verification transactions. Returned result shapes state `complete` and an opaque continuation only when a caller deliberately requests a page. A page boundary is transport framing, never a claim that the remaining scope was not reviewed.

Safe-regex restrictions remain because they prevent unsafe computation, not because they select source. Literal and identifier matching retain explicit case-sensitive behavior. Search result ordering is stable by path and line. Read range ordering is stable by path and starting line.

The source inventory and deterministic integrity checks must use the same incremental read primitive rather than maintaining a second whole-file reader. The content-bearing `SourceDocument` compatibility form remains evaluation-only; production tool-assisted work carries source metadata/path scope and reads exact locations through the jail. No schema-valid production source record may be truncated.

## Compatibility, structure, and verification

This is an incremental refactor, not a new parser or language service. The reusable structures are:

```text
src/
  platform/filesystem/{filesystem.schema,jailed-read-only-filesystem}  # cursor-safe source port
  features/target-inventory/                                           # complete incremental inventory
  features/review-workflow/
    runtime/{context-overflow,recovery,source-tools,invocation}        # shared orchestration only
    stages/                                                            # typed stage request projection/reduction only
    tools/                                                             # one model-facing continuation contract
```

All new external/persisted shapes are strict feature-owned Zod schemas with inferred types. Existing report/checkpoint readers reject an artifact that claims a new recovery state without the new schema version; legacy completed artifacts remain readable only through their existing compatibility paths. The implementation must update generated schema artifacts and all contract tests.

Required automated evidence:

- inventory and tool tests prove every eligible source line/match can be reached past former limits, with unknown extensions and mixed casing;
- tests inject Purista `ModelError(... reason: context_length_exceeded)` and prove initial unsplit invocation, stable recursive partitioning, no pre-estimate branch, shared-tool-scope isolation, and content-free telemetry;
- each stage's reducer proves its table row, including non-lossless incomplete/failure behavior;
- checkpoint/resume tests prove a later overflow never repeats a matching map/posture/grounding checkpoint;
- privacy tests prove artifacts/logs do not expose child source paths/ranges, prompts, raw outputs, or provider bodies;
- an opt-in five-repeat provider evaluation under a newly recorded protocol/configuration fingerprint measures the change. It must not be compared as a same-route regression with a run using the former caps.

Checklist walk: `core`, `end-to-end-definition`, `architecture-structure`, `contracts-generation`, `service-topology`, `testing-verification`, `security-abuse`, `performance-capacity`, `runtime-platform`, `async-integrations`, `files-media`, and `ai-ml-automation` are covered by the requirements above. Frontend, persistence/database, webhooks, and distributed worker topology are not applicable: v1 is a single-process CLI with file checkpoints and no browser/API surface.
