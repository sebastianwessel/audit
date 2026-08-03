# Evidence-first review migration

Date: 2026-07-30

CAP-065 and CAP-066 replace the direct vector-to-hypothesis workflow with a separately checkpointed source evidence map, map-bound hypotheses, and a source-backed control assessment. The change addresses the measured root cause—shallow, anchored reasoning—not the symptoms with a language-specific detector, benchmark rule, parser, or required second model.

The independent verifier route remains an opt-in evaluation experiment. Product audit semantics use one configured primary route with separate mapping, investigation, and verification stages. Reports, checkpoints, and evaluation artifacts advance their version/fingerprint boundary before evidence-first results may be compared with earlier artifacts.
