# Telemetry and coverage contract cleanup

Status: implemented on 2026-08-04.

## Decision

The report and checkpoint contracts remove two obsolete fields:

- `deterministicCandidateCount`, which described a retired structural path and
  was not a reliable account of the evidence-first candidate lifecycle;
- `budgetExhausted`, which was always false because the product deliberately
  has no fixed repository-tool budget.

The canonical evidence-map, obligation-closure, and admission-funnel fields
already provide the complete source-free account of candidate progression and
tool activity. The private audit report therefore advances to v21, terminal
vector checkpoints to v17, and the public report projection to v5.

## Compatibility

This is intentionally breaking. Current schemas reject prior shapes; there is
no reader, translator, migration command, or compatibility fallback. Historical
artifacts remain historical evidence only and must not be used as current audit
inputs.

## Verification

- Strict schemas reject either retired field.
- Markdown and evaluation projections contain no budget column or stale
  candidate counter.
- Generated JSON Schema artifacts match their feature-owned Zod sources.
