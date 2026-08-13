---
name: setup-browser
description: Detect, configure, and verify the DevKit Playwright MCP browser integration.
---

# Set up browser integration

Call `devkit_capability` with `{ module: "browser", enabled: true }` before inspecting the `browser` MCP tool catalog. The activation is scoped to this agent and automatically returns to hidden when the current turn ends. If it is healthy, perform a minimal navigation and accessibility snapshot smoke test and return to the original task.

If missing, verify Node.js and `npx`, then confirm `dsh-devkit-browser` is installed in the active profile. The Bundle pins `@playwright/mcp`; do not silently replace its version. Start once and let Playwright report whether its browser binary is absent. Run only the exact browser-install command it recommends, because downloading executables changes the machine and may require network access.

Verify with a harmless local or public page: navigate, read the title/accessibility tree, inspect console, then close. Keep headless, isolated mode and restricted file access. Never enable unrestricted file access, persistent storage state, arbitrary page evaluation, or origin-wide permissions merely to make a test pass.

Tool visibility is context shaping, not a browser sandbox. Continue to rely on isolated Playwright state, restricted file access, target-origin limits, and Harness approval for high-authority calls.
