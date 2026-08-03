# Reading the report

Start with coverage, then findings, then limitations.

## Report order

1. Vector coverage: matched files, a closure row for each planned review obligation, investigation candidate count, findings, and limitations.
2. Errors or partial vectors.
3. Confirmed claims, in stable identifier order.
4. Evidence links, short excerpts, and the static verification record.
5. Limitations and any human-review-required items.
6. Human-review disclaimer.

## Finding admission ledger

New reports include a small numeric funnel for every vector. It shows how many model hypotheses were rejected because their evidence did not validate, how the independent verifier decided, and how many findings finally entered the report. Use it to distinguish a model miss from an evidence-quality rejection or an incomplete verification.

The ledger intentionally contains counts only. It never includes source code, prompts, tool results, or model explanations. Older reports may not have this section; its absence means the historical report did not record it, not that every count was zero.

## Obligation closure

Read each closure row as the audit trail for one planned question. A row marked **no source-backed candidate** means the reviewer completed its bounded review without retaining a candidate; it does not certify the code as secure. A row marked **incomplete** or **not reached** means the audit did not finish that planned work. In either case, the vector must not be treated as fully covered.

The JSON report is for automation. The Markdown report is a readable rendering of the same validated data. If they disagree, treat the run as invalid and keep the JSON for diagnosis.

When you compare two reports, the separate lineage output tracks only exact finding identities. Treat **resolved** as a review signal, not proof that a change fixed the issue. If either report did not complete the relevant vector, the lineage state is **unknown**.

Evidence excerpts are shortened and redact common credential literals, bearer tokens, and email addresses before they are stored. Use the referenced file and line in your protected repository when a reviewer needs the original surrounding code.

## Triage after confirmation

The report intentionally does not assign priority, confidence, impact, or a proposed patch. Decide those after reviewing the confirmed claim in its product context. Do not treat a static result as proof that an exploit works, and do not close a claim until the change has been reviewed and tested.
