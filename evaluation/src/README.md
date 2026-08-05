# Evaluation feature

Owns strict fixture and real-world corpus schemas, content-free corpus-readiness assessment, baseline comparison, isolated corpus loading, deterministic/provider runners, scoring, and Markdown/JSON analysis. Keep implementation and tests side by side. The evaluator uses trusted code and never exposes manifests, answer keys, baselines, or scorer logic to the Purista agent.

Candidate acquisition is separate from corpus loading: `candidate-registry.*` validates provenance-bound, metadata-only leads against an already-local upstream checkout. It cannot mount source, create an answer key, or change a readiness score.
