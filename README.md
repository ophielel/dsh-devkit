# dsh-devkit

面向 DeepSeek Harness 的软件开发增强套件：按需安装 GitHub、浏览器验证、开发 Skills 和临时运行时扩展，不需要 fork 或修改 Harness。

[![CI](https://github.com/ophielel/dsh-devkit/actions/workflows/ci.yml/badge.svg)](https://github.com/ophielel/dsh-devkit/actions/workflows/ci.yml)

## 能做什么

- 为常见开发任务提供可复用 Skills：修复 CI、处理 GitHub Issue、评审 PR、安全重构、前端调试和环境排障。
- 让 Harness 按任务使用 GitHub Issue、PR、Actions 等能力。
- 使用 Playwright 检查页面结构、Console、Network 和可访问性信息。
- 对删除、强制推送、凭据访问、浏览器高权限操作等风险调用发起审批或拒绝。
- 在需要时启用 Harness 自带的临时 Cordis 扩展工具。

## 典型使用场景

- “读取这个 Issue，修改代码并准备 PR。”
- “检查失败的 CI，定位原因并修复。”
- “启动页面，查看 Console 和 Network 错误。”
- “评审这个 PR，只报告有实际影响的问题。”
- “临时加载一段受信任的 Cordis 扩展完成专项任务。”

## 安装

需要 Node.js `22.19+`（22.x）或 `24+`，以及随 Node.js 提供的 `npx`。源码 checkout 模式适配官方 DeepSeek Harness `0.1.0-rc.5`。

不需要全局安装 Harness，也不需要执行 `npm install -g @deepseek-ai/dsh`。`dsh-devkit` 会优先使用 `PATH` 中已有的 `dsh`；如果不存在，则自动调用：

```sh
npx --yes @deepseek-ai/dsh ...
```

先检查环境：

```sh
npx dsh-devkit doctor
```

打开安装选择界面：

```sh
npx dsh-devkit install --profile web
```

使用方向键移动、空格选择、Enter 安装。也可以直接使用预设：

```sh
npx dsh-devkit install --preset frontend --profile web
npx dsh-devkit install --preset backend --profile web
npx dsh-devkit install --preset full --profile web
```

或者明确选择组件：

```sh
npx dsh-devkit install --modules core,github,browser --profile web
```

常用选项：

- `--dry-run`：只显示将执行的命令。
- `--no-verify`：安装后不运行 Harness 配置检查。
- `--profile <name>`：安装到指定 Harness profile。

如果已经把 `dsh-devkit` 安装到 `PATH`，可直接使用 `dsh-devkit ...` 代替 `npx dsh-devkit ...`。

## 可选组件

| 组件 | 用途 |
| --- | --- |
| `core` | 风险操作提醒、凭据保护和开发 Skills。建议安装。 |
| `github` | GitHub Issue、PR、仓库和 Actions 工作流。 |
| `browser` | 基于 Playwright 的页面检查与浏览器调试。 |
| `runtime` | Harness 临时 Cordis 扩展工具，仅用于受信任代码。 |

## GitHub 凭据

使用 GitHub 组件前，在启动 Harness 的环境中提供 fine-grained PAT：

```powershell
$env:GITHUB_PERSONAL_ACCESS_TOKEN = '<fine-grained PAT>'
```

```sh
export GITHUB_PERSONAL_ACCESS_TOKEN='<fine-grained PAT>'
```

只授予目标仓库和当前任务需要的权限。不要把真实 token 写进仓库、配置、聊天或命令历史；优先使用系统的凭据管理方式注入环境变量。

## 开始使用

安装完成后，推荐通过 DevKit 启动 Harness：

```sh
npx dsh-devkit launch --profile web
```

该命令仍会优先使用 `PATH` 中的 `dsh`，否则通过 `npx` 调用官方 Harness。它不会把启动环境中的 `DEEPSEEK_API_KEY` 传给 Harness，因此 Models 页面可以保存和轮换 DeepSeek API 密钥；系统环境变量本身不会被修改。

如果当前运行明确需要使用环境变量中的密钥（例如 CI 或一次性覆盖），请直接启动官方 Harness：

```sh
npx --yes @deepseek-ai/dsh --profile web
# 或：dsh --profile web
```

可以先检查实际启动命令：

```sh
npx dsh-devkit launch --profile web --dry-run
```

从 Harness 源码 checkout 启动时：

```sh
npx dsh-devkit launch --profile web --harness <path-to-deepseek-harness>
```

- `launch` 只移除子进程的 `DEEPSEEK_API_KEY`；不会读取、显示或删除它，也不会改变其他环境变量。

- GitHub 能力默认按任务启用；需要时让 agent 加载 `setup-github` Skill。
- 浏览器能力需要时加载 `setup-browser` Skill；仅在 Playwright 明确提示时安装浏览器文件。
- 排查安装或 profile 问题时加载 `troubleshoot-devkit` Skill，或运行 `npx dsh-devkit doctor`。
- Runtime 组件只应运行你信任的扩展代码。

## 卸载

```sh
npx dsh-devkit uninstall --modules core,github,browser,runtime --profile web
```

## 安全说明

DevKit 会减少不必要的工具暴露，并为多类高风险操作增加审批或拒绝，但它不是安全沙箱。Harness 的 sandbox、subprocess/approval policy、操作系统权限和远程服务权限仍是真正的安全边界。

架构、安全模型与限制见 [DECISIONS.md](DECISIONS.md)，后续计划见 [TODO.md](TODO.md)。

## 从源码运行

正式用户优先使用 `npx dsh-devkit ...`。开发此项目时可从源码 checkout 运行：

```sh
git clone https://github.com/ophielel/dsh-devkit.git
cd dsh-devkit
pnpm install --frozen-lockfile
node ./packages/installer/lib/cli.js doctor
node ./packages/installer/lib/cli.js install --profile web --harness <path-to-deepseek-harness>
```
