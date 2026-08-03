# Immutable evidence, root topology, and terminal truth

## Decision

Wave 1 is a clean breaking boundary rebuild. It replaces live target reads, timestamp-shaped plan identity, permissive artifact roots, and ad-hoc terminal summaries. Versions before plan v2, report v15, checkpoint v13, and grounding draft v4 are rejected; no migration adapter or compatibility fallback is allowed.

## Root topology and artifacts

The CLI canonicalizes target, optional context, and output roots first. Any equality or ancestor/descendant overlap is invalid input. It validates this before directory creation, inventory, plan/checkpoint reads, provider construction, or model dispatch. Target and context remain separate evidence classes and therefore cannot overlap.

The artifact store has distinct read and write resolvers. Reads never create a component. Writes walk existing components without following symlinks, create only containment-proven missing components under the output root, use restrictive permissions where the operating system supports them, write a temporary sibling, revalidate the destination, and atomically rename. The platform documents an unsupported no-follow guarantee and fails closed rather than silently weakening it.

## Source admission and snapshot

`target-inventory/` owns `SourceAdmissionPolicySchema`, `SourceSnapshotManifestSchema`, and canonical target fingerprinting. Policy decisions are visible manifest entries, not implicit `.gitignore` interpretation. Named default exclusions are VCS metadata, dependency/vendor caches, build/generated output, and local secret stores; an explicit operator policy can override a named default. A regular UTF-8 file admitted by policy has exactly one sorted row containing normalized relative path, byte length, SHA-256 digest, and private snapshot-object reference. Non-regular, symlink, unsafe, and invalid-encoding entries have closed exclusion/error reasons.

The snapshot streams exact safe byte transactions into private content-addressed objects. It does not concatenate the corpus, retain a second full-corpus string, or reopen live target content after acceptance. Its fingerprint is SHA-256 over canonical sorted `(path, byteLength, contentDigest)` rows. `repo_list`, `repo_read`, and `repo_grep` can enumerate or read only admitted snapshot objects in their scoped manifest. A cursor/range transaction preserves CRLF, LF, CR, and final-newline state and automatically continues until complete. No policy or transport rule may omit an otherwise admitted file because of language, extension, source size, line count, match count, or tool count.

## Sealed plan and checkpoint identity

`attack-planning/` owns canonical serialization, `vectorDigest`, `planDigest`, and stable IDs. Vector canonical content includes title, rationale, enabled state, canonical scope globs, identified ordered obligations, limitations, applicability/evidence-basis fields, and protocol/schema version. Plan canonical content adds the vector sequence, ordered non-executable additional observations, target snapshot identity, and context digest. `createdAt` and presentation-only metadata are outside the digest. The sealed JSON plan is the only executable plan input. A deterministic Markdown projection is human review material only. Additional observations are uniquely identified human-review suggestions, never implicit work: they cannot reach audit dispatch, report findings, priority/fix text, CI, or evaluation scoring. `plan-draft` derives a constrained JSON draft that contains base-plan identity, editable vector fields, editable observations, and exact base observation promotion IDs; it cannot alter target/context identity, inventory, display metadata, or derived identities. `plan-reseal` accepts the exact base plus that strict draft, rejects a base-binding mismatch or no-op, converts a selected exact base observation into a normal enabled vector, derives fresh IDs, and publishes a new immutable JSON/Markdown pair. YAML and Markdown are never parsed as executable plan input.

Each checkpoint binds run ID, exact plan/vector digests, snapshot/context identity, provider/model/verifier route, phase, and relevant prompt/tool protocol fingerprints. Terminal checkpoints bind the contributing-phase aggregate. Resume selects only the latest exact reusable boundary and begins after it. A binding mismatch rejects reuse before a provider call.

## Terminal reducer and ownership

`audit-execution/terminal-classification` owns a strict exhaustive reducer. Its inputs are enabled/excluded vector state, per-obligation closures, reached phase ledger, stable stop code, and report-publication result. Its only outputs are terminal status, counters, report outcome, evaluator status, and exit code. No caller may derive one of those outputs independently. Before any checkpoint, report, lineage, or evaluator consumer can use them, the feature-owned strict schemas must reject cross-field contradictions between closure rows, coverage counters, per-vector finding queues, report finding queues, and admission funnels.

Each output root has one exclusive lease from validated run identity through final artifact publication. The attempt record is content-free, atomic, and transitions from `starting` to exactly one terminal state. Reached observations survive every catch path and report-write failure. Operators resume with an explicit command; checkpoints are not hand-edited.

## Verification

- Root-topology tests cover equality, both ancestor directions, symlink aliases, and validation-before-I/O.
- Snapshot tests cover streaming, one-row admission, explicit exclusions, unknown extensions, CRLF/LF, and post-inventory mutation.
- Plan/checkpoint matrix tests mutate one identity component at a time and prove dispatch cannot occur.
- Terminal-reducer tests cover every single and mixed closure/stop combination.
- Artifact-store tests cover read side effects, symlink swaps, concurrent writers, unresolved-lease fail-closed behavior, interruption, atomic failure, and supported permissions.
