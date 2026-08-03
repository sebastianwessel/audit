# Generic evidence-fact architecture

Status: superseded and retained as a historical rationale only. It is not an implementation proposal.

## Decision

The proposed fact layer and optional language adapters were not promoted. Even when framed as additive, parser-derived facts and deterministic evidence relations would privilege the languages and benchmark shapes they understand. They cannot establish the application-level security semantics needed for language-agnostic review.

The normative replacement is the language-neutral, human-plan-gated investigator and independent verifier loop in [the evidence-reasoning architecture](../specs/03-architecture/02-evidence-fact-pipeline.md). Deterministic code owns only safety and integrity checks: scope, bounded access, closed contracts, source-location validity, redaction, checkpoint binding, and state transitions.

## Non-goals preserved by the replacement

- No parser, AST adapter, regex, API-name rule, language hint, corpus answer key, or benchmark-specific condition may establish a security conclusion.
- Unknown-language UTF-8 source remains eligible evidence.
- Evaluation may expose gaps but may not create product rules or prompt exceptions.
