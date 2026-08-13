# dsh-devkit decisions

## 2026-08-14 — Phase 1 architecture

### Harness mechanisms to reuse

- Target DeepSeek Harness `0.1.0-rc.5`. The local checkout and the remote `master` commit from 2026-08-13 agree on that release.
- Install through the official `dsh plugin --profile <name> add <package>` command. Every installable module is a normal npm package declaring `dsh.bundle.patch`; the DevKit does not keep a second plugin registry.
- Compose capabilities as independent Bundle layers. The user's profile remains the final owner and may override any row in its own `cordis.patch.yml`.
- Bridge mature external services through `@deepseek-ai/dsh-mcp-client`.
- Register workflow guidance through `ctx.skills.register()` so skills remain separate from tool implementations.
- Enforce approval-requiring calls through `tools/pre-execute`, returning Harness-native `ask` decisions so the existing approval audit and UI remain authoritative. Reject credential-shaped argument values with the later monotonic `tools.guard()` seam so another listener cannot force-allow them.
- Reuse `@deepseek-ai/dsh-cordis-host-runner` and `@deepseek-ai/dsh-tool-cordis` for temporary runtime extensions. The DevKit does not invent another dynamic loader.
- Keep model-visible capability sets small twice: install independent Bundles per profile, then use agent-scoped `tools.restrict()` to hide GitHub, Browser, and Runtime tools until a task Skill enables one for the current turn.

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

`npx dsh-devkit install` presents a keyboard-only module picker. It invokes the official Harness plugin command once per selected module. Source-checkout installs resolve detected package locations at runtime; published installs use exact package versions. Presets are only installer shortcuts and never become a second composition format.

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
- MCP schemas can be numerous. Separate Bundles, GitHub's narrowed toolsets, and per-agent restrictions limit prompt cost. Restriction is visibility composition rather than authorization, and scoped registrations are deliberately exempt in Harness.
- Safety matching is defense in depth, not a shell parser or security sandbox. Harness sandbox and approval policy remain the actual authority boundaries.
- Dynamic Cordis code is equivalent to shell-level trust. It is opt-in and relies on Harness's audited in-memory lifecycle; persistence is deliberately excluded.

## 2026-08-14 — MVP hardening: task-scoped tools and layered policy

### Context

Installing all MVP Bundles registered every MCP and Runtime schema for every request. The original Safety Guard used a few regexes only in `tools/pre-execute`; it could miss unknown GitHub verbs, encoded commands, credential stores, permission changes, and the Cordis definition stage. Neither prompt instructions nor name matching is an authority boundary.

### Decision

- Keep Bundle installation profile-wide, because the official plugin manager owns composition and MCP connection lifecycle.
- Add one global `devkit_capability` tool. For each live agent, Core applies a deny restriction to inherited `mcp__github__*`, `mcp__browser__*`, and `cordis_*` tools. A monotonic guard rejects an unenabled module even if a stale catalog still shows it. A task Skill enables one module, and the durable `session/event` `turn/end` edge clears all enables for completed, failed, and aborted turns. `tools/change` refreshes restrictions after MCP reconnect/catalog changes.
- Use deny restrictions rather than an allow-list for the entire Harness catalog. Core owns only DevKit integrations and must not accidentally remove the profile's ordinary filesystem, shell, planning, or user-interaction tools.
- Keep high-risk but potentially legitimate operations on the Harness-native `ask` path. Treat unknown GitHub verbs as writes, ask for Cordis define/run/stop/undefine, encoded execution, destructive operations, privilege changes, sensitive reads, SQL writes, and high-authority browser calls.
- Add a monotonic guard only for credential-shaped values already embedded in tool arguments. Approval is not an appropriate escape hatch for copying a secret through model-visible arguments; callers must use Harness credentials or environment references instead.

### Alternatives rejected

- **Unload MCP servers after every task:** higher reconnect latency, unstable tool generations, and more lifecycle failure modes. Visibility restriction achieves the prompt-surface goal without taking ownership from the MCP client.
- **Global allow-list of every permitted Harness tool:** brittle across profiles and Harness releases, and would make DevKit the accidental owner of capabilities it did not install.
- **Regex guard as sandbox:** impossible to make complete across shells, wrappers, custom tools, nested interpreters, and future schemas. The classifier remains defense in depth.
- **Deny every sensitive read:** breaks legitimate, explicitly approved diagnosis and migration work. Sensitive targets ask; actual credential-shaped argument values deny.

### Consequences and limits

- The persistent model-facing overhead is one small capability tool plus the Skill catalog; heavy schemas appear only in tasks that request them.
- `tools.restrict()` filters inherited tools and does not filter a tool registered in the exact agent scope. Runtime-generated tools therefore require the Runtime trust decision and Harness policy; DevKit does not claim containment.
- Restriction refresh installs the replacement before lifting the previous mask and rolls back a failed enable/disable state change. The execution guard fails closed when visibility refresh itself cannot complete.
- Rule matching can have false positives and false negatives. Harness sandbox, approval/subprocess policy, OS/container isolation, remote service permissions, and token scope remain authoritative.
- Secret denial prevents forwarding recognized credential values in a tool call. It cannot erase a value already placed in a prompt, log, session, subprocess environment, or remote system.
- CI pins third-party Actions to immutable commits and gates syntax, tests, high-severity production dependency audit, package contents, clean npm installation, and installed CLI startup on both supported Node release lines.

### Safety classification details

The `tools/pre-execute` classifier requests Harness-native approval for recursive or forced deletion, device writes, dangerous Git workspace/history/remote operations, encoded or dynamically evaluated commands, privilege escalation, permission widening, sensitive credential-store or process-environment reads, unknown or mutating GitHub operations, SQL data/schema writes, high-authority browser actions, Runtime activation, and Cordis define/run/stop/undefine calls.

Credential-shaped values already present in tool arguments take a stricter path: the monotonic `tools.guard()` rule denies recognized tokens, bearer credentials, and private-key material instead of offering an approval escape hatch. Placeholder values remain usable in documentation and dry runs.

This policy is deliberately layered rather than presented as containment. `tools.restrict()` reduces the persistent model-visible surface, the execution guard fails closed for an unenabled DevKit module when catalog refresh state is stale, and approval handles high-risk but potentially legitimate calls. None of these mechanisms replaces Harness sandboxing, subprocess and approval policy, OS/container isolation, remote-service permissions, or credential scope.

### DeepSeek model implications

Current official DeepSeek V4 API models support thinking-mode tool calls, a 1M context window, and large outputs. Tool-calling conversations must preserve `reasoning_content` across subsequent tool requests. DevKit therefore leaves model message handling to Harness, keeps tool schemas scoped by installed Bundle, prefers short structured tool output, and encodes long workflows as lazily loaded Skills rather than permanent system-prompt text.
