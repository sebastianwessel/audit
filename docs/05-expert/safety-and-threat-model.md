# Safety and threat model

The main threat is not only a false positive. It is an agent being persuaded by repository content to do something outside the audit.

| Boundary | Default |
| --- | --- |
| Target reads | Allowed only through a jailed adapter. |
| Target writes | Disabled. |
| Shell/process execution | Disabled. |
| Network from tools | Disabled. |
| Running-instance probing or exploit execution | Out of scope and unavailable. |
| Model provider connection | Opt-in and configured separately. |
| Prompt/context persistence | Disabled by default. |
| Telemetry content | No content. |

The strongest practical deployment is an ephemeral CI runner with minimal credentials, no access to production secrets, local-only private work, and a public artifact directory that is uploaded after the reviewer has produced its source-minimal projection. Redaction is defence in depth, not the boundary that makes an artifact uploadable.
