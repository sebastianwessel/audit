# Configuration adapter

Loads the optional project-local `.env` and inherited environment, then validates the closed runtime configuration. Precedence is built-in defaults, inherited environment, then `.env`; CLI inputs select an operation but never override configuration. It owns provider/model selection, separate `AUDIT_PUBLIC_ARTIFACT_DIR` and `AUDIT_PRIVATE_WORK_DIR` roots, evaluation paths, and the positive `AUDIT_MAX_PARALLEL_VECTORS` in-flight queue capacity; it never caps total review work. Credentials never leave this boundary except through the provider adapter.
