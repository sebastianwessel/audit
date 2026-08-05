# Context and evaluation specification update

Date: 2026-07-27

This is a pre-implementation specification update; no existing persisted artifacts or user data require migration.

## Changes

- Clarified that the target is repository source plus optional, allowlisted Markdown/frontmatter context.
- Explicitly excluded live-instance probing, exploit execution, target-code execution, target network calls, and source mutation.
- Added data-protection review expectations for PII, secrets, credentials, tenant data, logs, telemetry, and proprietary data.
- Added evaluation feature contracts, starter fixtures, benchmark tracks, metrics, answer-key isolation, provenance, contamination controls, and CI gates.
- Added `evaluation/src/` while preserving capability-owned vertical slices and side-by-side tests.
