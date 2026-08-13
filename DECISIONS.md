# dsh-devkit decisions

## 2026-08-14 — Phase 1 architecture

### Harness mechanisms to reuse

- Target DeepSeek Harness `0.1.0-rc.5`. The local checkout and the remote `master` commit from 2026-08-13 agree on that release.
- Install through the official `dsh plugin --profile <name> add <package>` command. Every installable module is a normal npm package declaring `dsh.bundle.patch`; the DevKit does not keep a second plugin registry.
- Compose capabilities as independent Bundle layers. The user's profile remains the final owner and may override any row in its own `cordis.patch.yml`.
- Bridge mature external services through `@deepseek-ai/dsh-mcp-client`.
- Register workflow guidance through `ctx.skills.register()` so skills remain separate from tool implementations.
- Enforce high-risk calls through `tools/pre-execute`, returning Harness-native `ask` decisions so the existing approval audit and UI remain authoritative.
- Reuse `@deepseek-ai/dsh-cordis-host-runner` and `@deepseek-ai/dsh-tool-cordis` for temporary runtime extensions. The DevKit does not invent another dynamic loader.
- Keep model-visible capability sets small by installing independent Bundles and letting the installer choose them per profile.

### MCP, native plugin, and Skill split

| Capability | Extension | Reason |
| --- | --- | --- |
| GitHub Issue, PR, CI | MCP | GitHub maintains an official remote MCP server and exposes task-specific toolsets. |
| Browser verification | MCP | Playwright MCP already exposes accessibility snapshots, console, network, and DOM-driven actions. |
| Safety classification | Native Cordis plugin | It must participate in Harness's `tools/pre-execute` approval pipeline. |
| Development workflows | Skills | They are procedures and recovery guidance, not new execution authority. |
| Temporary runtime capability | Existing Harness native plugins | Harness already owns lifecycle, inspection, stop, and unload semantics. |
| Sentry, PostgreSQL, code graph | Later independent MCP Bundles | Useful, but outside the installable MVP and credential/read-only policy still needs focused validation. |

### Project structure

```text
dsh-devkit/
  packages/
    installer/   # dsh-devkit bin and TUI
    core/        # safety plugin plus embedded Skills
    github/      # official GitHub remote MCP Bundle
    browser/     # Playwright MCP Bundle
    runtime/     # Harness dynamic extension tools Bundle
  DECISIONS.md
  TODO.md
```

### Bundle and installation design

`npx dsh-devkit install` presents a keyboard-only module picker. It invokes the official Harness plugin command once per selected module. Local development installs use absolute package paths; published installs use exact package versions. Presets are only installer shortcuts and never become a second composition format.

The installer's state machine has four events: `move`, `toggle`, `submit`, and `cancel`. Rendering is a pure projection of selection state. Non-interactive use requires `--preset` or explicit `--modules`, and emits no ANSI control sequences.

### MVP

- Installer with interactive picker, presets, doctor, dry-run, and uninstall.
- Core Bundle with approval guard and nine focused development/setup Skills.
- GitHub remote MCP Bundle.
- Headless Playwright MCP Bundle with DOM/accessibility, console, and network capabilities; screenshots remain optional.
- Runtime extension Bundle using Harness's existing Cordis runner/tool pair.
- Automated unit tests plus a real `dsh --dump-config` integration smoke test.

### Compatibility and safety risks

- Harness is pre-release. Bundle config is pinned to `0.1.0-rc.5`; `doctor` must reject an incompatible installed release instead of guessing.
- Remote GitHub MCP requires a PAT in `GITHUB_PERSONAL_ACCESS_TOKEN`. Credentials stay in the environment and are never written by the installer.
- Playwright MCP is pinned because its CLI is pre-1.0. Browser installation may still require a one-time download.
- MCP schemas can be numerous. Separate Bundles and GitHub's narrowed toolsets limit prompt cost; further per-agent restriction remains a later improvement.
- Safety matching is defense in depth, not a shell parser or security sandbox. Harness sandbox and approval policy remain the actual authority boundaries.
- Dynamic Cordis code is equivalent to shell-level trust. It is opt-in and relies on Harness's audited in-memory lifecycle; persistence is deliberately excluded.

### DeepSeek model implications

Current official DeepSeek V4 API models support thinking-mode tool calls, a 1M context window, and large outputs. Tool-calling conversations must preserve `reasoning_content` across subsequent tool requests. DevKit therefore leaves model message handling to Harness, keeps tool schemas scoped by installed Bundle, prefers short structured tool output, and encodes long workflows as lazily loaded Skills rather than permanent system-prompt text.

