# Provider evaluation preflight

Status: implemented.

CAP-100 adds `bun run eval:provider:preflight` as the mandatory provider-free readiness boundary for a later paid `eval:provider` invocation. The command shares the evaluation option grammar and preparation path, but has no provider construction, network, checkpoint, artifact, target execution, or target mutation.

It validates a named credential's presence only in the provider-resolution adapter, exact bundled pricing, route distinction, corpus/source integrity, selected population, execution-profile constraints, protocol/config identities, and private-holdout attestation. Its JSON result contains only non-secret route names, key-variable names, booleans, counts, corpus identity, and fingerprints.

`eval:provider` now calls that same preparation path before it constructs a provider, so a paid invocation cannot bypass an already validated prerequisite. Unknown model prices now fail before a provider call rather than producing an unpriced evaluation result. This is a clean development-time behavior change; no legacy evaluation run, checkpoint, or compatibility translation is retained.

Verification: colocated provider-adapter and evaluator tests cover credential absence, unknown prices, isolated preflight success, and the normal fake-provider evaluation path. The command is documented in the public command and corpus guides and mirrored in agent implementation guidance.
