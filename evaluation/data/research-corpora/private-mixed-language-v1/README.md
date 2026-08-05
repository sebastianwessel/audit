# Private mixed-language diagnostic corpus

This local, source-only pack contains six vulnerable/patched pairs in Python, Go, Rust, C#, Ruby, and PHP. It is a semantic-regression fixture pack: it exercises workflow behavior across language families without adding language-specific reviewer rules.

All answer keys and reviewed plans are evaluator-only. Each key is provisional and every provider result from this pack is diagnostic: it cannot establish real-world accuracy, reliability, provider quality, or approve a model.

Validate the complete source snapshots and workflow integration without provider credentials:

```bash
bun run eval:corpus:integration -- --corpus evaluation/data/research-corpora/private-mixed-language-v1
```

An explicitly requested one-repeat provider diagnostic may use `--plan-profile audit-reviewed-plan`; it remains non-qualifying. The target code is never executed. The runner mounts one source variant at a time and reads the matching answer key only after the audit has closed.
