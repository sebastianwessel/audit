# Reading the report

Start with the outcome and actionable findings, then check coverage before acting.

## Report order

1. Outcome: whether this bounded static run completed, produced accepted source-backed findings, requires human review, or has incomplete work.
2. Actionable findings: the sealed plan's review question, a concise redacted claim, why the operation and unsafe-condition locations matter, declared limitations, complete evidence bundles, verification state, and a deterministic next-step checklist.
3. Coverage and review state: matched-file counts, a closure row for each planned review obligation, investigation candidate counts, findings, and closed limitation codes when coverage could not establish something.
4. What to do next: one concise action for every vector.
5. Human-review-required items and errors or partial vectors.
6. Technical appendix: closure, admission funnel, and source-free operational accounting.

## What to do next

The per-vector action table is deliberately narrow. It is derived only from the vector’s terminal state and, when present, its stable error code. It does not infer whether code is safe, unsafe, exploitable, or fixed.

- **Completed** means audit execution finished for that vector. Continue with the report review; it is not a guarantee that the target is secure.
- **Not applicable** is neutral. The report gives a fixed reason and the selected source locations: either no operation relevant to the obligation exists in the reviewed scope, or the obligation belongs to a component not represented there. Do not count it as a passed check or a finding.
- **Skipped** means that vector did not execute. Review the plan configuration if that coverage is needed.
- **Incomplete**, **failed**, and **cancelled** vectors are not covered. Investigate their terminal code and explicitly resume the same run if the review should continue.

## Finding admission ledger

New reports include a small numeric funnel for every vector. It shows how many model hypotheses were rejected because their evidence did not validate, how the independent verifier decided, and how many findings finally entered the report. Use it to distinguish a model miss from an evidence-quality rejection or an incomplete verification.

The ledger intentionally contains counts only. It never includes source code, prompts, tool results, or model explanations. Older reports may not have this section; its absence means the historical report did not record it, not that every count was zero.

## Obligation closure

Read each closure row as the audit trail for one planned question. A row marked **no source-backed candidate** means the reviewer completed its bounded review without retaining a candidate; it does not certify the code as secure. A source-backed verifier rejection is also a completed negative result. A row marked **incomplete** or **not reached** means the audit did not finish that planned work; this includes a case where code behavior was visible but the supplied source and context could not establish the required security consequence. In either case, the vector must not be treated as fully covered.

The JSON report is for automation. Each audit persists a Markdown projection beside it for people; the `report` command renders the same validated JSON again. If they disagree, treat the run as invalid and keep the JSON for diagnosis.

When you compare two reports, the separate lineage output tracks only exact finding identities. Treat **resolved** as a review signal, not proof that a change fixed the issue. If either report did not complete the relevant vector, the lineage state is **unknown**.

Reports never store source excerpts, prompts, raw model output, provider metadata, or verifier reasoning. A finding retains only a concise, redacted claim and role explanations so a human can understand what needs checking; those words are not evidence or proof. Use the referenced file, line, role, and content digest in your protected repository when a reviewer needs the original surrounding code.

## Triage after confirmation

The report intentionally does not assign priority, confidence, impact, or a proposed patch. Decide those after reviewing the confirmed claim in its product context. Do not treat a static result as proof that an exploit works, and do not close a claim until the change has been reviewed and tested.
