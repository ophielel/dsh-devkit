import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { MODULES } from './selection.js'

const moduleById = new Map(MODULES.map(module => [module.id, module]))

export function buildHarnessInvocation(harness, args) {
  if (harness !== undefined) {
    return {
      command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      args: ['dsh', ...args],
      cwd: harness,
    }
  }
  return {
    command: process.platform === 'win32' ? 'dsh.cmd' : 'dsh',
    args,
    cwd: process.cwd(),
  }
}

export function packageSpecFor(moduleId, { localRoot, version }) {
  const module = moduleById.get(moduleId)
  if (module === undefined) throw new Error(`未知模块：${moduleId}`)
  if (localRoot !== undefined) return resolve(localRoot, 'packages', moduleId)
  return `${module.packageName}@${version}`
}

export function runHarness(harness, args, { dryRun = false, stdout = process.stdout, stderr = process.stderr } = {}) {
  const invocation = buildHarnessInvocation(harness, args)
  const printable = [invocation.command, ...invocation.args].map(quoteArgument).join(' ')
  stdout.write(`$ ${printable}\n`)
  if (dryRun) return { status: 0, command: printable }
  const spawned = process.platform === 'win32'
    ? {
        command: process.env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c', [invocation.command, ...invocation.args].map(quoteCmdArgument).join(' ')],
      }
    : invocation
  const result = spawnSync(spawned.command, spawned.args, {
    cwd: invocation.cwd,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error !== undefined) {
    stderr.write(`无法执行 ${invocation.command}: ${result.error.message}\n`)
    return { status: 1, command: printable }
  }
  return { status: result.status ?? 1, command: printable }
}

function quoteCmdArgument(value) {
  if (/^[A-Za-z0-9_@./:\\=-]+$/.test(value)) return value
  return `"${value.replaceAll('%', '%%').replaceAll('"', '""')}"`
}

function quoteArgument(value) {
  if (/^[A-Za-z0-9_@./:\\=-]+$/.test(value)) return value
  return JSON.stringify(value)
}
