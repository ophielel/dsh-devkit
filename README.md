# dsh-devkit

`dsh-devkit` 是 DeepSeek Harness `0.1.0-rc.5` 的第三方软件工程增强套件。它不 fork、不修改 Harness 核心；安装器只调用官方 `dsh plugin --profile … add …` 机制。

[![CI](https://github.com/ophielel/dsh-devkit/actions/workflows/ci.yml/badge.svg)](https://github.com/ophielel/dsh-devkit/actions/workflows/ci.yml)

当前 MVP 包含四个可独立选择的 Bundle：

- `core`：会话级工具可见性、危险操作审批/拒绝守卫，以及 9 个开发、调试、评审和环境恢复 Skills。
- `github`：GitHub 官方远程 MCP，限定为 context、repos、issues、pull_requests、actions 工具集。
- `browser`：固定版本的 Playwright MCP，默认 headless + isolated，优先 DOM、可访问性快照、Console 和 Network，图片响应默认关闭。
- `runtime`：复用 Harness 自带的 Cordis inspect/define/run/stop/undefine 工具，不实现第二套动态加载器。

架构取舍和风险记录见 [DECISIONS.md](DECISIONS.md)，后续路线见 [TODO.md](TODO.md)。

## 快速开始

确保 `dsh` 已在 `PATH` 中，然后检查环境：

```sh
npx dsh-devkit doctor
```

打开小型 TUI，使用方向键移动、空格选择、Enter 安装：

```sh
npx dsh-devkit install --profile web
```

也可以跳过 TUI：

```sh
npx dsh-devkit install --preset frontend --profile web
npx dsh-devkit install --preset backend --profile web
npx dsh-devkit install --preset full --profile web
npx dsh-devkit install --modules core,github --profile web
```

安装器会在最后自动运行 `dsh --profile <name> --dump-config`。仅查看将执行的命令可加 `--dry-run`。如果已经把 CLI 安装到 `PATH`，以上命令中的 `npx dsh-devkit` 可直接写成 `dsh-devkit`。

## 从源码 checkout 运行

本地开发此仓库时使用相对路径。安装器默认自动调用 `PATH` 中的 `dsh`；只有要运行 Harness 源码 checkout 时才传 `--harness <path-to-deepseek-harness>`：

```powershell
git clone https://github.com/ophielel/dsh-devkit.git
cd dsh-devkit
pnpm install --frozen-lockfile
node ./packages/installer/lib/cli.js doctor
node ./packages/installer/lib/cli.js install --profile web --harness <path-to-deepseek-harness>
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
cd <path-to-deepseek-harness>
pnpm install
pnpm run build
pnpm dsh --profile web
```

Runtime Bundle 面向官方 `web` profile；该 profile 已提供 `dynamicCordisRunner`。若自定义 profile 不提供该服务，runtime 工具会保持等待状态，其他 Bundle 不受影响。

## 安全模型

### 最小工具面

GitHub、Browser 与 Runtime Bundle 可以安装在同一 profile 中，但它们的工具默认不会长期暴露给模型。Core 只保留小型 `devkit_capability` 工具；匹配任务的 Skill 会先按当前 agent 启用对应模块，durable `turn/end`（完成、失败或取消）时自动恢复隐藏。MCP 重连或工具目录变化时会重新计算限制。

这是 Harness `tools.restrict()` 上的会话级上下文收敛，只减少 schema/token、误调用和 excessive agency，不授予或撤销操作系统、网络、GitHub 或 Cordis 权限。限制只作用于继承的工具；作用域自身注册的工具按 Harness 设计不受它过滤。Core 另用同一会话状态注册单调执行 guard，使目录刷新失败时残留的未启用 DevKit 工具也会 fail-closed；它仍只是 Harness 进程内的一层策略。

### 审批与拒绝

Safety Guard 在 Harness 的 `tools/pre-execute` 阶段识别下列高风险操作，并返回原生 `ask` 决定：

- 递归/强制删除、设备写入与危险 Git 工作区/历史/远端操作；
- 编码或动态求值命令、提权和扩大文件权限；
- 可能读取 `.env`、SSH/AWS/GitHub/Kubernetes 凭据或整个进程环境的调用；
- GitHub 未知或写操作（只对明确的只读名称放行）；
- SQL 数据或 schema 写操作；
- 浏览器脚本执行、文件上传、权限授予和网络路由等高权限调用；
- 临时 Cordis 扩展的定义、运行、停止与删除，以及 Runtime 工具启用。

若任意工具参数已经包含已知格式的真实 token、Bearer 凭据或私钥内容，Core 通过 Harness 的单调 `tools.guard()` 直接拒绝；后续 pre-execute 监听器不能把它强制放行。占位文本不会误判为真实凭据。

### 非安全边界

Safety Guard 只是 defense-in-depth 分类器，不是 shell/PowerShell/SQL 解析器，也不是安全沙箱。别名、自定义工具、未来新增的参数形态或刻意构造的命令都可能绕过启发式匹配；工具可见性同样不是授权。

真正的权限边界仍是：Harness workspace sandbox、subprocess policy、approval policy 与审批 UI；操作系统账号/容器权限；GitHub PAT 的仓库与 permission scope；Playwright 的 isolated context 和文件访问限制。Runtime 扩展相当于 shell 级信任，可能改变同一进程内其他会话可见的行为，即使其定义生命周期由一个会话拥有。

不要把 secret 放入提示词或工具参数。Guard 不能撤回已经进入模型上下文、会话历史或外部服务的值；发生泄漏时必须立即吊销并轮换凭据。

## 卸载

```sh
npx dsh-devkit uninstall --modules core,github,browser,runtime --profile web
```

卸载同样通过官方 `dsh plugin remove`，不会手工编辑 profile manifest。

## 测试

```powershell
pnpm test
pnpm run lint
pnpm check:portability
pnpm audit:prod
pnpm verify:pack
```

`check:portability` 会扫描已跟踪及待提交文件，拒绝工作站目录、开发者 home 路径、盘符路径和 UNC 路径。`verify:pack` 会真实打出五个 npm tarball，在全新的临时项目中执行 `npm install`，检查发布文件的可移植性，再运行安装后 CLI 的 help 与全模块 dry-run。CI 在 Node 22.19 和 Node 24 上执行同一套门禁。MVP 还通过了隔离 `DSH_HOME` 下的真实 Bundle 安装、`--dump-config`、Web profile 启动与 HTTP 200 烟测，以及 Windows ConPTY 中的方向键/选择/提交测试。

## 常见问题

- `frontend dist not built` 或缺少 `lib/*.js`：在 Harness 根目录运行 `pnpm run build`。
- GitHub tools 默认隐藏：加载 `setup-github` Skill；它会为当前任务调用 `devkit_capability`。若仍不出现，再确认启动 DSH 的同一环境里存在 `GITHUB_PERSONAL_ACCESS_TOKEN`。
- Browser tools 默认隐藏：加载 `setup-browser` Skill；它会为当前任务启用 Browser。仅在 Playwright 明确提示缺少浏览器时执行它给出的安装命令。
- Bundle 在配置里但插件失败：加载 `troubleshoot-devkit` Skill，按 profile 配置、live plugin inventory、MCP 边界的顺序检查。
