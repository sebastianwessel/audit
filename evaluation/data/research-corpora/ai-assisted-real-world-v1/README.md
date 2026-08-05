# AI-assisted real-world development corpus

This private development pack reuses complete locally acquired source-pair evidence without downloading or executing a target. Each key is authored by one traceable source-only AI review and is deliberately `targeted`: it measures recovery of the known patch-anchored issue and its absence from the patched variant. It does not measure general precision, external reliability, or model selection.

The pack does not use an upstream CVE/CWE label as an answer key. The key records source ranges, a source-only reasoning note, and a paired negative expectation. It is never mounted into the agent target view.

Its one recorded source-only review also follows the pinned
[`CALIBRATION_PROTOCOL.md`](./CALIBRATION_PROTOCOL.md). That makes this exact
pair available for internal development calibration only. It remains targeted,
AI-assisted evidence: it does not establish general precision, reliability,
independent validation, or model selection.
