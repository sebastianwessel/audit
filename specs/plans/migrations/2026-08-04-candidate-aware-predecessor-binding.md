# Candidate-aware predecessor binding

This is a clean breaking checkpoint boundary. `AuditCandidateAwareCheckpointSchema` moves from v4 to v5. Earlier checkpoints are rejected; no reader, converter, or compatibility path is retained.

Every pending, running, or completed verifier/countercheck checkpoint now persists the exact validated evidence-map and source-posture fingerprints in addition to its canonical candidate fingerprint. Reuse requires all three predecessor identities to match the current grounding draft. A changed map or posture therefore restarts only the affected candidate-aware unit and cannot reuse an old decision or overflow topology.
