# Public/private artifact boundary

Status: implemented and offline-verified on 2026-08-04. This migration supersedes any wording that
describes regex redaction or safe model-authored prose as a publication
boundary. There is no legacy reader or output-root compatibility mode.

## Decision

Every audit command has two explicit, canonical, non-symlink roots:

| Root | Permitted content | Consumer |
| --- | --- | --- |
| public artifact root | source-minimal report, lineage, deterministic manifest | operator and CI upload |
| private work root | target/context snapshots, sealed plans and Markdown projections, editable plan drafts, checkpoints, leases, evaluator work, resumable state | local review/resume/discard only |

The roots must be pairwise disjoint from each other and every target/context
root. Equal, ancestor, descendant, symlink, or unresolved topology fails
before target I/O, provider construction, or artifact write.

Raw prompt/model/tool values are ephemeral only. The public root never contains
target/context text, model-authored free prose, snippets, secrets, credentials,
provider request identifiers, checkpoints, locks, source snapshots, sealed
plans, or plan drafts. Plans remain local private-work artifacts for human
review and must not be published by the product.

Public finding/report text is deterministic: closed decision/gap tokens,
stable templates, evidence roles/locations/digests, plan-independent labels,
and numeric observations. A regex sanitizer remains a defence-in-depth display
helper only; it never justifies persistence of arbitrary model prose.

## Required implementation

1. Replace the single artifact-root configuration/CLI contract with required
   public-artifact and private-work roots. Reject old artifact shapes and flags.
2. Move every snapshot, recovery leaf, checkpoint, lock, and evaluator work
   path beneath private work. Move only publishable report/lineage projections
   beneath public artifacts.
3. Remove persisted model-authored statements, explanations, limitations, and
   verifier reasons from public and resumable artifacts. Replace them with
   closed reason tokens plus deterministic render templates. Preserve only
   source-minimal references required for provenance.
4. Add a closed exact-run discard command for private work. It validates the
   immutable run binding and removes no other root or run state. Normal
   completion may release private snapshots only after final ownership closes;
   stopped work remains private and resumable until explicitly discarded.
5. Update public documentation: CI uploads the public root only; private work
   is for resume/discard and must not be published. Documentation must not link
   to this internal migration/spec.

## Verification

- Sentinel source/context/model strings are absent from every public JSON and
  Markdown artifact for completed, partial, failed, cancelled, and resumed
  runs.
- Private work can resume an interrupted audit without copying its contents to
  the public root.
- Root topology tests reject equality, both ancestor directions, symlink
  aliases, and validation after no target/provider activity.
- The discard command removes only the named exact private run and rejects an
  invalid binding, root, or incomplete identity.
- CLI help, README, and public docs use the two-root flow and no longer promise
  excerpts or redaction-safe publication.
