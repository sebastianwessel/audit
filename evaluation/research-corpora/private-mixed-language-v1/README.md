# Private mixed-language diagnostic corpus

This local, source-only pack contains six vulnerable/patched pairs in Python, Go, Rust, C#, Ruby, and PHP. It is designed to expose workflow regressions across language families without adding language-specific reviewer rules.

All answer keys and reviewed plans are evaluator-only. Each key is provisional and every provider result from this pack is diagnostic: its metrics are useful for investigation, but cannot establish real-world reliability or approve a model.

Run it explicitly with:

```bash
bun run eval:provider --corpus evaluation/research-corpora/private-mixed-language-v1 --plan-profile reviewed-plan --repetitions 5
```

The target code is never executed. The runner mounts one source variant at a time and reads the matching answer key only after the audit has closed.
