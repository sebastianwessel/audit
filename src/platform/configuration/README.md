# Configuration adapter

Loads the optional project-local `.env` and inherited environment, then validates the closed runtime configuration. Precedence is built-in defaults, inherited environment, `.env`, and explicit CLI flags. It owns provider/model selection, artifact/evaluation paths, and the `SECURITY_REVIEWER_MAX_PARALLEL_VECTORS` cap; credentials never leave this boundary except through the provider adapter.
