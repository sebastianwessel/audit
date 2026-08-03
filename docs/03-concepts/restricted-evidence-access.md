# Restricted evidence access

The auditor has three kinds of read-only tools:

| Tool | Simple explanation |
| --- | --- |
| repo_list | Show which allowed files exist. |
| repo_read | Read an allowed regular UTF-8 file, or an exact requested line range. |
| repo_grep | Search allowed files and return matching lines. It supports literal text, identifier search, and safe regular expressions with explicit casing. |

The auditor does not receive a shell. It cannot run a target test, install a package, follow a URL, or write a patch.

## What “allowed” means

1. The operator selects a target root.
2. Security Reviewer resolves that root to a real directory.
3. Every requested path is treated as relative to that root.
4. Traversal, absolute paths, NUL bytes, and symlink escapes are rejected.
5. Eligible regular UTF-8 files are not excluded because of their language, extension, size, line count, or number of matches.
6. The product records tool use for operational visibility, but does not impose a fixed call, result, or byte cap that silently omits approved evidence.

Provider context capacity is handled separately. The reviewer waits for the provider to signal a context-window error, then recovers the same source paths, ranges, and applicable context without guessing. If the resulting decision cannot be merged safely, the vector is marked incomplete instead of being treated as clean.

Identifier search is useful when you are looking for a code name such as `authorize` or `userId`: it avoids treating a longer name that merely contains those letters as the same identifier. This rule is deliberately language-neutral.

This is a practical safety boundary, not a promise that every possible threat in an untrusted host environment disappears. Use an isolated CI runner for especially sensitive targets.

## Source is data

Repository files may contain instructions aimed at an AI agent. The auditor must ignore those instructions and use the files only as evidence. The same rule applies to README files, comments, fixtures, vendored code, and context documents.
