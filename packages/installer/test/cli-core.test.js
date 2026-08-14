import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { buildHarnessInvocation, packageSpecFor } from '../lib/execution.js'
import { parseArgs } from '../lib/options.js'
import { decodeKey, displayWidth, renderPicker } from '../lib/tui.js'
import { createPickerState } from '../lib/selection.js'

test('argument parser accepts a non-interactive install preset and Harness source path', () => {
  assert.deepEqual(
    parseArgs(['install', '--preset', 'backend', '--profile', 'dev', '--harness', './harness', '--dry-run']),
    {
      command: 'install',
      preset: 'backend',
      modules: undefined,
      profile: 'dev',
      harness: './harness',
      dryRun: true,
      yes: false,
      noVerify: false,
    },
  )
})

test('argument parser rejects conflicting module selectors', () => {
  assert.throws(
    () => parseArgs(['install', '--preset', 'full', '--modules', 'core']),
    /不能同时使用 --preset 和 --modules/,
  )
})

test('Harness invocation uses pnpm dsh for a source checkout', () => {
  const source = buildHarnessInvocation(
    './harness',
    ['plugin', '--profile', 'web', 'add', 'x'],
    { commandExists: () => { throw new Error('PATH must not be checked for a source checkout') } },
  )
  assert.equal(source.command, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  assert.deepEqual(source.args, ['dsh', 'plugin', '--profile', 'web', 'add', 'x'])
  assert.equal(source.cwd, './harness')
})

test('Harness invocation prefers dsh on PATH', () => {
  const invocation = buildHarnessInvocation(
    undefined,
    ['--profile', 'web', '--dump-config'],
    { commandExists: command => command === 'dsh' },
  )
  assert.equal(invocation.command, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
  assert.deepEqual(invocation.args, ['--profile', 'web', '--dump-config'])
})

test('Harness invocation falls back to the official package through npx without assuming a published version', () => {
  const invocation = buildHarnessInvocation(
    undefined,
    ['--profile', 'web', '--dump-config'],
    { commandExists: () => false },
  )
  assert.equal(invocation.command, process.platform === 'win32' ? 'npx.cmd' : 'npx')
  assert.deepEqual(invocation.args, [
    '--yes',
    '@deepseek-ai/dsh',
    '--profile',
    'web',
    '--dump-config',
  ])
})

test('local package spec resolves from a checkout and registry spec pins the module version', () => {
  assert.equal(packageSpecFor('core', { localRoot: './devkit', version: '0.1.0' }), resolve('./devkit', 'packages', 'core'))
  assert.equal(packageSpecFor('github', {}), 'dsh-devkit-github@0.1.0')
})

test('TUI key decoder maps only active picker controls', () => {
  assert.deepEqual(decodeKey('\u001b[A'), { type: 'move', delta: -1 })
  assert.deepEqual(decodeKey(' '), { type: 'toggle' })
  assert.deepEqual(decodeKey('\r'), { type: 'submit' })
  assert.deepEqual(decodeKey('q'), { type: 'cancel' })
  assert.equal(decodeKey('x'), undefined)
})

test('TUI renderer is a pure narrow-safe projection with active key hints', () => {
  const state = createPickerState(['core'])
  const first = renderPicker(state, { profile: 'web', width: 58 })
  const second = renderPicker(state, { profile: 'web', width: 58 })
  assert.equal(first, second)
  assert.match(first, /› \[x\] Core safety \+ skills/)
  assert.match(first, /↑↓ 移动  Space 选择  Enter 安装  q 退出/)
  const narrow = renderPicker(state, { profile: 'web', width: 38 })
  assert.ok(narrow.split('\n').every(line => displayWidth(line) <= 38))
})
