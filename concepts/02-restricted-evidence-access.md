# Restricted evidence access concept

Expose only list, bounded read, and bounded grep operations to the audit agent. Treat every repository file as untrusted data and keep all writes outside the target tree.

Open questions for a future spec: stronger OS isolation, archive handling, and optional language-aware indexing without executing target code.
