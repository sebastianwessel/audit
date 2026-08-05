# Environment-only runtime configuration

## Decision

Runtime configuration has one resolution path: built-in defaults, inherited process environment, then the ignored project-root `.env`. Command arguments select one operation and its bounded local inputs, but cannot override runtime configuration.

The configuration adapter exclusively owns provider, model, credential-variable name, verification route, verifier credentials, vector concurrency, and the optional observed-cost dispatch guard. Provider routes and all runtime limits are rejected when supplied as CLI flags before filesystem or provider I/O.

## Consequences

- `plan`, `audit`, guidance, and every provider-evaluation entrypoint resolve the same configured primary route.
- An independent verifier route is configured only through `.env`.
- `AUDIT_MAX_PARALLEL_VECTORS` remains a queue capacity, not a work cap.
- `AUDIT_MAX_ESTIMATED_COST_USD` remains an optional shared observed-cost guard, not a source, tool, output, or request limit.
- No compatibility aliases, precedence fallback, or migration path exists for retired runtime CLI flags.

Per-operation CLI inputs such as target, plan, context, case/split selection, run identity, recovery intent, output root, and debug diagnostics remain explicit because they identify a single bounded operation rather than select its runtime behavior.
