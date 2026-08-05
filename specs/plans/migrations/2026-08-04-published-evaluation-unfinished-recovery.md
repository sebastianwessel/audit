# Published evaluation unfinished recovery

Status: implementation authorized by the product owner on 2026-08-04.

Provider evaluation previously published a diagnostic-red run as a completed command, preserving the report but preventing the failed or incomplete trials from being retried under the same bound run. This contradicted the explicit unfinished-recovery contract.

The provider evaluator now permits `--resume true --retry-unfinished true` only for a completed frozen run that has retained unfinished trials. It validates and atomically retains the old public terminal set in the private evaluator work root, reuses completed trial results and compatible phase predecessors, and dispatches only unfinished work before publishing a replacement terminal set. A normal completed run remains immutable; no implicit retry or whole-corpus replay is introduced.

Error traversal now recognizes nested aggregate failures, allowing a normalized Purista model error to retain its existing provider-neutral code even when cleanup wraps it. No prompt, source, tool payload, raw model response, provider message, request id, or secret is persisted.
