# Private-holdout attestation

The earlier qualification contract trusted a single locally loaded corpus pack to both contain and prove the private holdout. That makes an unseen holdout impossible to operate correctly: the development operator can see it, while a genuinely separate pack cannot demonstrate the full development-readiness count by itself.

The private holdout is now a physically separate steward-controlled pack. Before a provider measurement, the steward creates a source-free, strict Ed25519 envelope offline. Its canonical payload contains schema version, attestation id/date/issuer/purpose, exact holdout pack id/version/manifest digest, and the digest of the frozen full readiness report. The evaluator receives only the envelope and public key, rejects symlinks and invalid files, verifies key fingerprint/type, exact manifest binding, and signature, then records an id/digest/key/date reference with the run and checkpoint. The private key, source, answer keys, and readiness report are never loaded through this path.

`private-holdout` is issued only after that verification. `development-pilot` remains derived from the local development readiness report. This controls accidental overclaiming and creates an auditable authorization boundary; it does not replace operational access controls or make the current corpus qualified.
