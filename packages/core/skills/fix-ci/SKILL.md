---
name: fix-ci
description: Diagnose and repair failing CI from the first actionable failure without masking the signal.
---

# Fix CI

Load `setup-github` before inspecting a remote workflow run so GitHub tools are exposed only for this task.

Read the workflow run, job matrix, and first actionable failing step. Separate product failures from infrastructure, cancellation, flakiness, and downstream noise. Reproduce the same command locally when practical, preserving the CI runtime, working directory, environment assumptions, and dependency lockfile.

Add or update a regression test before changing behavior. Fix the root cause instead of weakening assertions, skipping tests, pinning unrelated dependencies, or adding blind retries. Run the focused failure locally, then the smallest broader gate that proves no adjacent regression. Report any platform-only check that cannot run locally.

Do not re-run remote workflows, edit workflow permissions, expose secrets, or push commits until the user has authorized the corresponding GitHub write. If authentication is missing, load `setup-github`, verify it, and resume the original diagnosis.
