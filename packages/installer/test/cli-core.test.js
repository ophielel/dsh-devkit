import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { buildHarnessInvocation, packageSpecFor } from '../lib/execution.js'
import { parseArgs } from '../lib/options.js'
import { decodeKey, displayWidth, renderPicker } from '../lib/tui.js'
import { createPickerState } from '../lib/selection.js'

test('argument parser accepts a non-interactive install preset and Harness source path', () => {
  assert.deepEqual(
    parseArgs(['install', '--preset', 'backend', '--profile', 'dev', '--harness', 'C:\\src\\harness', '--dry-run']),
    {
      command: 'install',
      preset: 'backend',
      modules: undefined,
      profile: 'dev',
      harness: 'C:\\src\\harness',
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

test('Harness invocation uses source checkout when supplied and installed CLI otherwise', () => {
  const source = buildHarnessInvocation('C:\\src\\harness', ['plugin', '--profile', 'web', 'add', 'x'])
  assert.equal(source.command, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  assert.deepEqual(source.args, ['dsh', 'plugin', '--profile', 'web', 'add', 'x'])
  assert.equal(source.cwd, 'C:\\src\\harness')

  const installed = buildHarnessInvocation(undefined, ['--profile', 'web', '--dump-config'])
  assert.equal(installed.command, process.platform === 'win32' ? 'dsh.cmd' : 'dsh')
  assert.deepEqual(installed.args, ['--profile', 'web', '--dump-config'])
})

test('local package spec is an absolute directory and registry spec pins the installer version', () => {
  assert.equal(packageSpecFor('core', { localRoot: 'C:\\devkit', version: '0.1.0' }), join('C:\\devkit', 'packages', 'core'))
  assert.equal(packageSpecFor('github', { version: '0.1.0' }), 'dsh-devkit-github@0.1.0')
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
