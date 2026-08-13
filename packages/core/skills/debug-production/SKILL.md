---
name: debug-production
description: Investigate production failures with read-only evidence, explicit hypotheses, and minimal-risk remediation.
---

# Debug production

Establish impact, start time, affected version, and a concrete symptom. Prefer read-only logs, traces, metrics, release metadata, and database queries. Keep a short hypothesis table: evidence for, evidence against, and the next discriminating check. Correlate identifiers and timestamps; do not infer causality from one noisy signal.

Never mutate production data, restart services, change feature flags, expose secrets, or run an unbounded query without explicit authority and approval. Redact tokens and personal data from notes. When a code fix is indicated, reproduce it locally or in an isolated environment, add a regression test, and follow the normal review path.

Conclude with the most likely cause, confidence, verified blast radius, safe mitigation options, and unanswered questions. Clearly distinguish observed facts from inference.

