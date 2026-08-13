---
name: review-pr
description: Review a pull request for correctness, security, compatibility, tests, and operational risk.
---

# Review a pull request

Load `setup-github` before reading remote pull request state so GitHub tools are exposed only for this task.

Read the pull request intent, linked issue, repository instructions, full diff, and tests. Trace changed data and control flow into callers and downstream consumers. Prioritize findings that can cause wrong behavior, security exposure, data loss, compatibility breaks, race conditions, or missing rollback/observability.

Validate each finding against the actual code and, when feasible, a focused reproduction. Report actionable findings with file and tight line ranges, the failing scenario, impact, and a concrete direction. Do not report stylistic preference as a defect, and do not invent behavior not supported by evidence.

Check that new behavior has meaningful tests, errors are observable, credentials are not logged, and public interfaces remain predictable. If there are no actionable findings, say so and note any verification limits. Commenting, approving, or requesting changes on GitHub is a remote write and requires user authorization.
