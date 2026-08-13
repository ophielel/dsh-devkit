---
name: debug-frontend
description: Debug a browser UI using accessibility, DOM, console, and network evidence before visual screenshots.
---

# Debug frontend

Load `setup-browser` before the first browser operation; it exposes the browser tools only for the current task and verifies the constrained integration.

Start the application with its documented development command and establish the exact URL and reproduction steps. Use Playwright's accessibility snapshot or targeted find operation to locate controls and state. Inspect console errors and relevant network requests before changing code; capture the actual response status and payload contract without exposing credentials.

Write the smallest automated regression at the layer that owns the bug. Implement the fix, reload from a clean state, repeat the user flow, and confirm DOM/accessibility state, console, and network are all clean. Test at a narrow viewport when layout or wrapping is relevant. A screenshot may document appearance, but never use pixels as the only proof of behavior.

Do not upload files, evaluate arbitrary page JavaScript, grant browser permissions, or access origins outside the user's task without approval. Load `setup-browser` if the MCP server or browser binary is unavailable.
