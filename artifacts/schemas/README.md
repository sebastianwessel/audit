# Generated schemas

Generated JSON Schema snapshots for persisted and boundary contracts belong here. Never hand-edit them.

Run `bun run schema:generate` after a Zod contract change and `bun run schema:check` in verification/CI. Snapshots describe Zod input shapes; runtime Zod validation remains authoritative for normalisation transforms that JSON Schema cannot express.
