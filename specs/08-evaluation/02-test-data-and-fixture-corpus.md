# Test data and fixture corpus

## Repository layout

```text
evaluation/
  fixtures/
    cases/<case-id>/
      case.json
      vulnerable.*
      fixed.*
      benign.*
      context.md
    safety/<case-id>/
    README.md
  corpora/
    README.md
    manifests/
  benchmarks/
    README.md
  runs/
    README.md
```

`evaluation/data/fixtures/` is safe, intentionally small, and versioned. `evaluation/runs/` contains generated output and is ignored. External corpora are never downloaded by the product or default CI; a contributor may add a separately licensed, pinned corpus only through a reviewed manifest and an offline import step.

## Fixture classes

Every pack contains:

- positive vulnerable/fixed pairs with one or more expected findings;
- benign negatives that resemble positive patterns but contain a valid control;
- ambiguous cases where the correct result is `needs-review` or abstention;
- safety cases containing inert prompt-injection-like text, traversal names, symlink metadata, oversized inputs, mixed-case tokens, and malformed provider output;
- multi-file cases where the issue is visible only through a caller, shared helper, configuration, or authentication boundary.

The reviewer implementation language does not limit target languages. Every bounded UTF-8 repository file may be inventoried and supplied as source evidence; language hints are best-effort metadata, not an allowlist or parser requirement. A benchmark language becomes eligible for a published score only when it has a repository-disjoint case family, a labeled vulnerable/patched pair set, and a documented review-prompt policy. Unsupported language-specific semantics must produce an explicit coverage limitation rather than a false claim of complete analysis.

The external corpus roadmap is language-balanced: JavaScript/TypeScript pairs provide the first offline pilot because a paired CVE corpus is available; C/C++, Java, Python, Go, C#, PHP, Ruby, and other languages are separate case families, not future product-language enablement decisions. Each family receives its own result slice and may not borrow a score from another language. A language is never described as unsupported merely because it lacks a benchmark family; the only valid statement is that no reliability score exists for that family yet.

## Ground truth

Each case is reviewed by a security-literate maintainer. The answer key records expected finding identifiers, role-specific file and line ranges, rationale, applicable controls, fixed-pair relationship, and whether the issue is expected to be detected, correctly abstained from, or treated as ambiguous. It must not contain exploit payloads that execute against live systems.

Ground truth is stored outside the agent-visible target root. The evaluation runner creates an agent view containing only fixture code and allowed context. The scorer opens the answer key only after the audit process finishes. A test proves the agent cannot read the key through relative paths, symlinks, context files, error messages, report paths, or tool output.

## Provenance and contamination

Every imported case records source URL or repository, commit/tag, retrieval date, license, checksum, transformation, human adjudicator, and removal/redistribution constraints. Public cases are split by repository/project so near-duplicate files do not cross train, development, and test partitions. A private synthetic holdout is required for release confidence because public benchmark content may be present in model training data.

Synthetic mutations are allowed only as a supplement. Mutation generators must be deterministic from a recorded seed, preserve a compiling or parseable fixture where applicable, record the mutation operator, and receive human validation. A regex-generated label is not accepted as ground truth without review.

## Required starter pack

The repository starts with a tiny TypeScript pack covering unsafe string-built query construction, its fixed parameterized counterpart, a benign guarded helper, and inert prompt-injection/path-boundary cases. It is a contract and smoke pack, not a language-support declaration, evidence of model capability, or a substitute for a broader corpus.
