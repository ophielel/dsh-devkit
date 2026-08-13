---
name: setup-browser
description: Detect, configure, and verify the DevKit Playwright MCP browser integration.
---

# Set up browser integration

First inspect the live Cordis/plugin inventory and tool catalog for the `browser` MCP server. If it is already healthy, perform a minimal navigation and accessibility snapshot smoke test and return to the original task.

If missing, verify Node.js and `npx`, then confirm `dsh-devkit-browser` is installed in the active profile. The Bundle pins `@playwright/mcp`; do not silently replace its version. Start once and let Playwright report whether its browser binary is absent. Run only the exact browser-install command it recommends, because downloading executables changes the machine and may require network access.

Verify with a harmless local or public page: navigate, read the title/accessibility tree, inspect console, then close. Keep headless, isolated mode and restricted file access. Never enable unrestricted file access, persistent storage state, arbitrary page evaluation, or origin-wide permissions merely to make a test pass.

