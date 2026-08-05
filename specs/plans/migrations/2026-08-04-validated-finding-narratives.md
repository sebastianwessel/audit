# Validated finding narratives

This is a clean breaking artifact boundary. `AuditReportSchema` moves from v19 to v20, `PublicAuditReportSchema` from v2 to v3, `AuditVectorCheckpointSchema` from v15 to v16, and `AuditCandidateGroundingDraftSchema` from v9 to v10. Earlier artifacts are rejected; no reader, converter, or compatibility path is retained.

The canonical grounded hypothesis and persisted finding gain one strict `ClaimNarrative`: a statement, exactly one artifact-text-redacted explanation for each selected evidence role, and zero or more artifact-text-redacted limitations. The verifier receives that exact narrative as claim context but must independently inspect source and may not use narrative text as evidence, provenance, identity, or admission proof. Finding identity continues to depend only on vector, approved obligations, and exact evidence selections. Equal identities with different validated narratives fail as invalid artifacts.

Public Markdown renders the same narrative for accepted and review-required items. The artifact still contains no source/context excerpts, prompts, tool data, raw model response, verifier rationale, or credentials.
