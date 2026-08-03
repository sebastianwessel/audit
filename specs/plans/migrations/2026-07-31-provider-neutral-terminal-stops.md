# Provider-neutral terminal stops

Date: 2026-07-31

## Decision

Timeout and cancellation are classified from Purista's normalized harness error category, never provider text, and remain explicit cancelled work rather than generic failed or incomplete work.

## Contract

- The shared model-stage retry boundary maps normalized `timeout` and `cancelled` categories to `provider-cancelled` and does not retry them.
- Audit maps that stable code to cancelled vector coverage while retaining any earlier source-free phase observations.
- Evaluation maps a planning stop or returned cancelled vector to a cancelled trial with null scores. Explicit unfinished recovery may retry it; ordinary resume does not.

## Verification

Runtime tests prove no retry after normalized cancellation/timeout. Audit tests prove cancelled coverage, and runner tests prove cancelled generated-plan trials without a provider-specific error parser.
