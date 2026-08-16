# ⚡ deepseek-forge

> 你的 DeepSeek Harness 开发锻造工坊——装上就能干活，不必 fork，不必魔改，不必重新发明轮子。

[![CI](https://github.com/ophielel/deepseek-forge/actions/workflows/ci.yml/badge.svg)](https://github.com/ophielel/deepseek-forge/actions/workflows/ci.yml)

别的工具让你配半天环境才能开始写代码，我们让你**今天就能开始**。deepseek-forge 是一套按需安装的开发能力包：GitHub、浏览器验证、九种开发工作流、一个会帮你盯着 token 消耗的监督员——全都长在 Harness 原生机制上，卸载即净，不留后遗症。

> 兼容说明：安装命令与各组件包继续沿用 `dsh-devkit` 命名（CLI 为 `npx dsh-devkit`），既有 profile 不受影响。

## ✨ 它能为你做什么

- **审慎而强大**：危险操作（删库、强推、读凭据、改权限……）自动走审批，凭据形状的参数直接拒，绝不给模型拿你的 secret 当工具参数的机会。
- **按任务启用，不刷存在感**：GitHub / 浏览器 / 运行时扩展默认隐身，任务需要时一个 `devkit_capability` 唤起，turn 结束自动收回。你的提示词里不该躺着二十个用不上的 schema。
- **九种开箱即用的开发 Skill**：修 CI、啃 GitHub Issue、审 PR、安全重构、前端调试、环境排障——都是"先看证据再动手"的干活流程，不是空话。
- **临时能力，随用随走**：受信任的 Cordis 扩展按需加载、停止、卸载，生命周期全交给 Harness 自己管，我们不搞第二套注册表。
- **Token Watch**：你的 token 账房先生。消耗超限后台审查、长时间工作定期体检、判定异常才请你拍板——详见下文。

## 🚀 30 秒上手

要求 Node.js `22.19+`（22.x）或 `24+`，以及随 Node 附赠的 `npx`。不需要全局安装 Harness——`dsh-devkit` 优先用你 PATH 里已有的 `dsh`，没有就自动 `npx @deepseek-ai/dsh`。

先体检：

```sh
npx dsh-devkit doctor
```

打开安装选择界面（方向键移动、空格选择、回车安装）：

```sh
npx dsh-devkit install --profile web
```

嫌交互慢？直接上预设：

```sh
npx dsh-devkit install --preset frontend --profile web   # 前端选手全家桶
npx dsh-devkit install --preset backend --profile web    # 后端选手全家桶
npx dsh-devkit install --preset full --profile web       # 成年人不做选择
```

也可以自己点菜：

```sh
npx dsh-devkit install --modules core,github,browser --profile web
```

常用选项：`--dry-run`（只看命令不执行）、`--no-verify`（装完跳过配置检查）、`--profile <name>`（装到指定 profile）。全局装过的话，直接用 `dsh-devkit ...` 代替 `npx dsh-devkit ...`。

## 📦 组件全家桶

| 组件 | 用途 |
| --- | --- |
| `core` | 风险操作提醒、凭据保护和开发 Skills。建议装。 |
| `github` | GitHub Issue、PR、仓库和 Actions 工作流。 |
| `browser` | 基于 Playwright 的页面检查与浏览器调试。 |
| `runtime` | Harness 临时 Cordis 扩展工具，仅用于受信任代码。 |
| `token-watch` | 消耗超限/长时间工作时后台并行审查，异常时暂停并请用户裁决。 |

## 🔐 GitHub 凭据

用 GitHub 组件前，在启动 Harness 的环境里提供 fine-grained PAT：

```powershell
$env:GITHUB_PERSONAL_ACCESS_TOKEN = '<fine-grained PAT>'
```

```sh
export GITHUB_PERSONAL_ACCESS_TOKEN='<fine-grained PAT>'
```

只授目标仓库和当前任务需要的权限，别把真实 token 写进仓库、配置、聊天或命令历史——让系统的凭据管理来注入，它比你的剪贴板安全。

## 🧭 开始使用

装完启动 Harness：

```sh
dsh --profile web
```

没有全局 `dsh` 时：

```sh
npx --yes @deepseek-ai/dsh --profile web
```

- GitHub 能力默认按任务启用，让 agent 加载 `setup-github` Skill 即可。
- 浏览器能力需要时加载 `setup-browser` Skill；只有 Playwright 明确提示时才装浏览器文件。
- 出问题别慌：加载 `troubleshoot-devkit` Skill，或 `npx dsh-devkit doctor`。
- Runtime 组件只运行你信任的扩展代码——你懂的。

## 🎯 Token Watch：你的 token 账房先生

长任务跑着跑着，模型钻进死胡同狂烧 token——这种事我们见多了。`token-watch` 就是为此生的：

- **消耗审查**：10 分钟窗口烧掉 30 万 token？后台立刻开个子代理审查这段活动，**主任务照跑，不打断**。只有两种时候它会叫停：审查期间窗口继续飙到硬停线（默认 60 万），或审查判定异常。
- **进度体检**：连续干满 30 分钟？自动检查一下模型是不是在钻牛角尖——反复试同一个失败方案、重复读同一份文件、空转没进展，一眼看穿。
- **请用户拍板**：判定异常才弹窗：继续 / 停止 / 关闭功能。审查子代理保留工具权限、能自己读文件核实，但最终必须给结构化结论。
- **随时关掉**：一句 `token_watch` 工具调用，或弹窗里一键关闭。审查失败一律放行，绝不卡住你的会话。

```sh
npx dsh-devkit install --modules core,token-watch --profile web
```

## 🧹 卸载

```sh
npx dsh-devkit uninstall --modules core,github,browser,runtime,token-watch --profile web
```

装了啥就卸啥，干净利落。

## ⚠️ 安全边界（说人话版）

DevKit 会减少不必要的工具暴露，并为多类高风险操作增加审批或拒绝，但**它不是安全沙箱**。真正的安全边界依然是：Harness 的 sandbox、subprocess/approval policy、操作系统权限和远程服务权限。我们负责把风险摊到你面前，你负责拍板——架构与限制详见 [DECISIONS.md](DECISIONS.md)，路线图见 [TODO.md](TODO.md)。

## 🛠️ 从源码运行

正式用户优先 `npx dsh-devkit ...`。想给本项目贡献代码？

```sh
git clone https://github.com/ophielel/deepseek-forge.git
cd deepseek-forge
pnpm install --frozen-lockfile
node ./packages/installer/lib/cli.js doctor
node ./packages/installer/lib/cli.js install --profile web --harness <path-to-deepseek-harness>
```
