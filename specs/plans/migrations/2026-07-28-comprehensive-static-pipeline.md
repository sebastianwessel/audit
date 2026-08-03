# Comprehensive static-analysis pipeline

Date: 2026-07-28

## Reason

The bootstrap report contract did not expose how an approved vector was scoped, investigated, or verified. Its single broad audit call could not prove that model findings remained inside human-approved scope.

## Changes

- Version 2 audit reports add per-vector evidence accounting, verified finding records, and source-supported attack chains.
- Audit execution is explicitly split into deterministic discovery, bounded per-vector investigation, verification, and synthesis.
- Context is passed to planner and investigator only as advisory, separately labelled evidence.
- A model finding that is out of scope, lacks a valid source line, or conflicts with its approved vector is rejected with visible coverage/error accounting.
- Follow-up: newly written v2 reports include a backward-compatible source-free admission funnel. It distinguishes model candidates, integrity/tool-evidence rejections, verifier outcomes, reconciliation failures, post-verification rejections, and admitted findings; strict count conservation prevents silent loss between stages. Older v2 artifacts remain readable with the ledger absent rather than misreported as zero.

## Compatibility

There are no released artifacts or users to migrate. The CLI will write only version 2 reports after this change and refuses version 1 reports where a version 2 schema is required.
