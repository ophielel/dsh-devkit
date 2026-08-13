---
name: setup-github
description: Detect, configure, and verify GitHub MCP authentication without storing or exposing tokens.
---

# Set up GitHub integration

Call `devkit_capability` with `{ module: "github", enabled: true }` before inspecting the GitHub tool catalog. The activation is scoped to this agent and automatically returns to hidden when the current turn ends. If GitHub tools then appear, call a read-only current-user or repository-context tool and return to the original task.

The Bundle connects to GitHub's official remote MCP server using `GITHUB_PERSONAL_ACCESS_TOKEN`. Check only whether that environment variable exists; never print it, copy it into a patch, write it to the repository, or place it in a command argument. If absent, ask the user to create a fine-grained PAT with the smallest repository scope and permissions needed by their task, set it in the environment that launches DSH, and restart the profile.

After the user completes that credential-only step, verify a read-only call. Explain missing token scope from the GitHub error rather than requesting a broad classic token. Do not create an Issue, comment, branch, PR, or workflow run as a setup test.

Tool visibility is least-privilege context shaping, not authorization. GitHub write calls still require the Harness approval boundary, and repository/token permissions remain authoritative.
