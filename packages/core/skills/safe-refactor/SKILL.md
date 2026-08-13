---
name: safe-refactor
description: Refactor incrementally while proving behavior remains stable and avoiding unrelated cleanup.
---

# Safe refactor

State the behavior that must remain unchanged and identify its current tests and public interfaces. If coverage is weak, add characterization tests before moving code. Split the work into small reversible slices; after each slice run the focused test and keep the project buildable.

Preserve error semantics, ordering, side effects, serialization, configuration defaults, and observable output unless the user explicitly requested a behavior change. Avoid opportunistic cleanup outside the target. Prefer direct code over new abstraction until repeated use justifies it.

At completion, run the relevant broader checks, inspect the diff for accidental changes, and explain why the result is behavior-preserving. Any destructive Git operation, large mechanical rewrite, or change outside the workspace requires approval.

