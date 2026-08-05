# Seed-owned grounding bindings

Candidate grounding no longer asks a model to repeat vector identity, plan obligations,
inherited evidence-map references, source-posture identifiers, or limitations already
owned by its paired discovery seed. The strict model-facing candidate now contains only
the claim statement and its two map-selection bundles.

Canonical grounding derives those bindings once from the seed and derives the complete
map basis from inherited references plus selected facts. A selected additional fact is
valid only when it binds an exact approved seed obligation. This is a breaking prompt
and contract evolution: checkpoints with an earlier grounding protocol fingerprint are
not reused, and no compatibility reader or translation path is provided.
