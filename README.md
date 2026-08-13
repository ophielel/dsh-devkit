# dsh-devkit

`dsh-devkit` 是 DeepSeek Harness `0.1.0-rc.5` 的第三方软件工程增强套件。它不 fork、不修改 Harness 核心；安装器只调用官方 `dsh plugin --profile … add …` 机制。

当前 MVP 包含四个可独立选择的 Bundle：

- `core`：危险操作审批守卫，以及 9 个开发、调试、评审和环境恢复 Skills。
- `github`：GitHub 官方远程 MCP，限定为 context、repos、issues、pull_requests、actions 工具集。
- `browser`：固定版本的 Playwright MCP，默认 headless + isolated，优先 DOM、可访问性快照、Console 和 Network，图片响应默认关闭。
- `runtime`：复用 Harness 自带的 `cordis_inspect/define/run/stop/undefine` 生命周期工具，不实现第二套动态加载器。

架构取舍和风险记录见 [DECISIONS.md](DECISIONS.md)，后续路线见 [TODO.md](TODO.md)。

## 直接运行当前源码

本项目本身没有第三方运行时依赖。先检查环境：

```powershell
cd C:\Users\24790\Desktop\10\dsh-devkit
node packages\installer\lib\cli.js doctor --harness C:\Users\24790\Desktop\deepseek-harness
```

打开小型 TUI，使用方向键移动、空格选择、Enter 安装：

```powershell
node packages\installer\lib\cli.js install --profile web --harness C:\Users\24790\Desktop\deepseek-harness
```

也可以跳过 TUI：

```powershell
node packages\installer\lib\cli.js install --preset frontend --profile web --harness C:\Users\24790\Desktop\deepseek-harness
node packages\installer\lib\cli.js install --preset backend --profile web --harness C:\Users\24790\Desktop\deepseek-harness
node packages\installer\lib\cli.js install --preset full --profile web --harness C:\Users\24790\Desktop\deepseek-harness
node packages\installer\lib\cli.js install --modules core,github --profile web --harness C:\Users\24790\Desktop\deepseek-harness
```

安装器会在最后自动运行 `dsh --profile <name> --dump-config`。仅查看将执行的命令可加 `--dry-run`。

发布到 npm 后的目标入口保持为：

```sh
npx dsh-devkit install
```

## GitHub 凭据

GitHub Bundle 从启动 DSH 的进程环境读取 `GITHUB_PERSONAL_ACCESS_TOKEN`，安装器不会读取其值，也不会把 token 写入任何配置文件。建议创建只覆盖目标仓库和任务所需权限的 fine-grained PAT。

当前 PowerShell 会话中设置：

```powershell
$env:GITHUB_PERSONAL_ACCESS_TOKEN = '<fine-grained PAT>'
```

随后在同一环境启动 Harness。不要把实际 token 写进仓库、命令历史、聊天或 `cordis.patch.yml`。

## 启动 Harness

本地源码 checkout 首次启动前需要按 Harness 官方说明构建一次：

```powershell
cd C:\Users\24790\Desktop\deepseek-harness
pnpm install
pnpm run build
pnpm dsh --profile web
```

Runtime Bundle 面向官方 `web` profile；该 profile 已提供 `dynamicCordisRunner`。若自定义 profile 不提供该服务，runtime 工具会保持等待状态，其他 Bundle 不受影响。

## 安全模型

Safety Guard 在 Harness 的 `tools/pre-execute` 阶段识别下列高风险操作，并返回原生 `ask` 决定：

- 递归/强制删除与危险 Git 历史操作；
- 可能读取 `.env`、SSH 私钥、凭据文件或 token 的调用；
- GitHub 写操作；
- SQL 数据或 schema 写操作；
- 浏览器脚本执行、文件上传和网络路由等高权限调用；
- 临时 Cordis 扩展的运行、停止与卸载。

它只是 defense-in-depth 分类器。真正的权限边界仍是 Harness 的 workspace sandbox、approval policy 与一次性审计审批。普通读取不会被额外打断。

## 卸载

```powershell
node packages\installer\lib\cli.js uninstall --modules core,github,browser,runtime --profile web --harness C:\Users\24790\Desktop\deepseek-harness
```

卸载同样通过官方 `dsh plugin remove`，不会手工编辑 profile manifest。

## 测试

```powershell
cd C:\Users\24790\Desktop\10\dsh-devkit
pnpm test
pnpm run lint
```

本次 MVP 还通过了隔离 `DSH_HOME` 下的真实 Bundle 安装、`--dump-config`、Web profile 启动与 HTTP 200 烟测，以及 Windows ConPTY 中的方向键/选择/提交测试。

## 常见问题

- `frontend dist not built` 或缺少 `lib/*.js`：在 Harness 根目录运行 `pnpm run build`。
- GitHub tools 不出现：确认启动 DSH 的同一个环境里存在 `GITHUB_PERSONAL_ACCESS_TOKEN`，然后加载 `setup-github` Skill。
- Browser tools 不出现：运行 `doctor`，再加载 `setup-browser` Skill；仅在 Playwright 明确提示缺少浏览器时执行它给出的安装命令。
- Bundle 在配置里但插件失败：加载 `troubleshoot-devkit` Skill，按 profile 配置、live plugin inventory、MCP 边界的顺序检查。

