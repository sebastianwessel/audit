# Human handoff and machine-readable CLI results

Status: implemented and offline-verified on 2026-08-04. No compatibility
reader or legacy output path is retained.

## Decision

This approved breaking update makes public audit reports understandable without
making them a source or model transcript. `PublicAuditReportSchema` moves to
v3. It keeps source-minimal evidence but adds redacted sealed-plan vector and
obligation context, and it retains closed, map-derived not-applicable reasons
with their exact selected source-minimal references.

`not-applicable` no longer accepts or persists free-form model prose. The only
durable codes are `no-relevant-operation-in-scope` and
`external-component-not-represented-in-scope`; Markdown renders their fixed
human wording. Plan v4 adds non-identity reseal provenance. A descendant keeps
the original `createdAt` and carries `resealedFromPlanId` and `resealedAt`.

All product commands accept opt-in `--result-format json`. Their strict stdout
result contains only command/status/exit information, stable IDs, and
jail-relative artifact paths. It is not a persisted artifact and never
contains source, context, prompts, model output, credentials, or Markdown.

## Compatibility

This repository is in development: public report v1 and plan v4 artifacts that
lack required descendant provenance are rejected rather than translated.
