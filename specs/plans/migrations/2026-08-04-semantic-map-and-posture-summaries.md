# Semantic map and posture summaries

## Decision

The audit retains one validated, artifact-text-redacted semantic summary on each canonical evidence-map fact and candidate-blind posture assessment. This repairs accidental semantic starvation between bounded model stages while preserving the existing source-minimal provenance and admission model.

## Boundaries

- A summary is never a source snippet, raw response, evidence selection, provenance record, deterministic decision input, finding identity, or public-report field.
- Live mapper and posture model outputs require the summary. Recovery accepts only current-version canonical artifacts; no older artifact version is read or translated.
- Map and posture dependency fingerprints include summaries. A changed summary invalidates later grounding and candidate-aware checkpoint reuse.

## Breaking artifacts

- `AuditEvidenceMapDraftSchema` v4 is replaced by v5.
- `AuditSourcePostureDraftSchema` v3 is replaced by v4.
- Map and posture recovery leaves v3 are replaced by v4.

Older artifacts are rejected.
