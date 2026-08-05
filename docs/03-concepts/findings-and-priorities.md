# Confirmed claims

Audit confirms a security claim before it tries to describe its business urgency or a preferred fix.

A confirmed finding contains:

- source evidence for the security-relevant operation and unsafe condition;
- the approved review obligation it answers;
- an independent verification record that also considered visible controls; and
- an explicit bounded-review state that keeps static-analysis uncertainty visible.

This separation is deliberate. A compelling severity label or a polished fix does not make a claim true. The reviewer first asks: “does this source-backed condition remain supported after controls are challenged?”

Human triage happens afterwards. Use the cited local source, the surrounding system context, and your own impact assessment to decide urgency, ownership, remediation, and validation. The tool never applies a patch or treats a static result as proof of runtime exploitability.

The same review covers data protection: code paths that may expose PII, credentials, secrets, tenant data, logs, telemetry, or proprietary data should include the relevant evidence and control assessment. The tool reasons from source and supplied context; it does not collect live data or attempt exfiltration.
