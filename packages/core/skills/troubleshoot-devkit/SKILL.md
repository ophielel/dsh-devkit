---
name: troubleshoot-devkit
description: Diagnose DevKit installation, Bundle activation, MCP startup, and approval failures in a fixed order.
---

# Troubleshoot dsh-devkit

Run `dsh-devkit doctor` and record only failed checks. Confirm the active profile, then use `dsh --profile <name> --dump-config` to verify the expected `dsh-devkit-*` layer and rows. Inspect the live plugin inventory for pending or failed fibers before changing any configuration.

For GitHub, check token presence without printing its value and make one read-only MCP call. For Browser, verify `node`, `npx`, the pinned Playwright MCP CLI, and the browser executable separately. For Core, confirm the safety plugin is active and its skills appear in the catalog. For Runtime, remember that web supplies the host runner while headless needs the runtime Bundle's runner row.

Fix one failed boundary at a time and repeat that boundary's smoke test. Do not reinstall everything, delete the profile, widen permissions, disable approval, or replace pinned dependencies as a first response. Preserve the original task and resume it automatically once the environment is healthy.
