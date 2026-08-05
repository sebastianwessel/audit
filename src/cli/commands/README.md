# CLI commands

`main.ts` owns process startup, generic parsing, configuration resolution, root preparation, and dispatch. It does not own command lifecycle logic.

The five command facades are `planning/` (`plan`, `plan-draft`, `plan-reseal`), `audit/` (`audit`, `discard`, recovery), `guidance/`, `lock/` (private-work lease inspection and explicit release), and `reporting/` (`report`, `lineage`). They receive typed dependencies from `main.ts`, never import it, and use feature-root facades for cross-feature behavior.
