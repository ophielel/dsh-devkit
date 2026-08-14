import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { commandExists, HARNESS_PACKAGE_SPEC, HARNESS_VERSION, packageSpecFor, runHarness } from './execution.js'
import { MODULES, modulesForPreset, normalizeModuleNames } from './selection.js'
import { runPicker } from './tui.js'

const VERSION = '0.1.2'

export async function resolveModuleSelection(options, {
  isInteractive = process.stdin.isTTY && process.stdout.isTTY,
  picker = runPicker,
} = {}) {
  if (options.preset !== undefined) return modulesForPreset(options.preset)
  if (options.modules !== undefined) return normalizeModuleNames(options.modules)
  if (!isInteractive) throw new Error('当前不是交互式终端；请使用 --preset 或 --modules')
  return picker({ profile: options.profile ?? 'web' })
}

export function createPluginArgs(command, profile, spec) {
  return ['plugin', '--profile', profile, command === 'install' ? 'add' : 'remove', spec]
}

export async function runApp(options, io = {}) {
  const stdout = io.stdout ?? process.stdout
  const stderr = io.stderr ?? process.stderr
  if (options.command === 'help') {
    stdout.write(helpText())
    return 0
  }
  if (options.command === 'doctor') {
    return runDoctor(options, { stdout, commandExists: io.commandExists ?? commandExists })
  }

  const selected = await resolveModuleSelection(options, {
    isInteractive: io.isInteractive ?? (process.stdin.isTTY && process.stdout.isTTY),
    picker: io.picker ?? runPicker,
  })
  if (selected === undefined) {
    stdout.write('已取消。\n')
    return 0
  }
  if (selected.includes('runtime') && options.profile !== 'web') {
    stderr.write('提示：Runtime tools 需要提供 dynamicCordisRunner 的 profile；官方 web profile 已提供。\n')
  }
  if (selected.includes('github') && !process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    stderr.write('提示：GitHub Bundle 已安装，但启用工具前需设置 GITHUB_PERSONAL_ACCESS_TOKEN。\n')
  }

  const localRoot = findLocalWorkspaceRoot()
  const byId = new Map(MODULES.map(module => [module.id, module]))
  for (const moduleId of selected) {
    const module = byId.get(moduleId)
    const spec = options.command === 'install'
      ? packageSpecFor(moduleId, { localRoot })
      : module.packageName
    const result = runHarness(
      options.harness,
      createPluginArgs(options.command, options.profile, spec),
      { dryRun: options.dryRun, stdout, stderr },
    )
    if (result.status !== 0) return result.status
  }

  if (options.command === 'install' && !options.noVerify) {
    const verification = runHarness(
      options.harness,
      ['--profile', options.profile, '--dump-config'],
      { dryRun: options.dryRun, stdout, stderr },
    )
    if (verification.status !== 0) return verification.status
  }
  stdout.write(`${options.command === 'install' ? '安装' : '卸载'}完成：${selected.join(', ')}\n`)
  return 0
}

function runDoctor(options, { stdout, commandExists: hasCommand }) {
  const rows = []
  const nodeVersion = process.versions.node
  rows.push({ ok: supportsNode(nodeVersion), label: 'Node.js', detail: nodeVersion })
  const hasNpx = hasCommand('npx')
  rows.push({ ok: hasNpx, label: 'npx', detail: 'Harness fallback and Playwright MCP launcher' })
  if (options.harness !== undefined) {
    rows.push({ ok: hasCommand('pnpm'), label: 'pnpm', detail: 'Harness source checkout launcher' })
    const manifestPath = resolve(options.harness, 'apps', 'cli', 'package.json')
    let version = 'missing'
    if (existsSync(manifestPath)) version = JSON.parse(readFileSync(manifestPath, 'utf8')).version
    rows.push({ ok: version === HARNESS_VERSION, label: 'DeepSeek Harness source', detail: version })
  } else if (hasCommand('dsh')) {
    rows.push({ ok: true, label: 'DeepSeek Harness', detail: 'dsh on PATH' })
  } else {
    rows.push({ ok: hasNpx, label: 'DeepSeek Harness', detail: `via npx ${HARNESS_PACKAGE_SPEC}` })
  }
  rows.push({ ok: Boolean(process.env.GITHUB_PERSONAL_ACCESS_TOKEN), warning: true, label: 'GitHub PAT', detail: process.env.GITHUB_PERSONAL_ACCESS_TOKEN ? 'present' : 'not set (only required for GitHub)' })
  for (const row of rows) stdout.write(`${row.ok ? '✓' : row.warning ? '!' : '✗'} ${row.label}: ${row.detail}\n`)
  return rows.some(row => !row.ok && !row.warning) ? 1 : 0
}

function supportsNode(version) {
  const [major, minor] = version.split('.').map(Number)
  return major >= 24 || (major === 22 && minor >= 19)
}

function findLocalWorkspaceRoot() {
  const candidate = resolve(import.meta.dirname, '../../..')
  return existsSync(resolve(candidate, 'packages', 'core', 'package.json')) ? candidate : undefined
}

function helpText() {
  return `dsh-devkit ${VERSION}\n\nUsage:\n  dsh-devkit install [--profile web] [--preset frontend|backend|full]\n  dsh-devkit install --modules core,github,browser,runtime\n  dsh-devkit uninstall --modules core,github\n  dsh-devkit doctor [--harness <source-checkout>]\n\nOptions:\n  --harness <path>  Use a DeepSeek Harness source checkout through pnpm dsh\n  --dry-run         Print official dsh plugin commands without executing them\n  --no-verify       Skip dsh --dump-config after installation\n`
}
