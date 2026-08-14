import assert from 'node:assert/strict'
import test from 'node:test'
import { createPluginArgs, resolveModuleSelection, runApp } from '../lib/app.js'

test('module selection resolves presets and explicit module lists without opening TUI', async () => {
  assert.deepEqual(
    await resolveModuleSelection({ preset: 'backend', modules: undefined }, { isInteractive: false }),
    ['core', 'github', 'runtime'],
  )
  assert.deepEqual(
    await resolveModuleSelection({ preset: undefined, modules: 'browser,core' }, { isInteractive: false }),
    ['core', 'browser'],
  )
})

test('module selection uses injected picker only in interactive mode', async () => {
  const picked = await resolveModuleSelection(
    { preset: undefined, modules: undefined, profile: 'web' },
    { isInteractive: true, picker: async options => options.profile === 'web' ? ['core'] : [] },
  )
  assert.deepEqual(picked, ['core'])
  await assert.rejects(
    resolveModuleSelection({ preset: undefined, modules: undefined }, { isInteractive: false }),
    /--preset 或 --modules/,
  )
})

test('plugin arguments preserve the official Harness profile management surface', () => {
  assert.deepEqual(
    createPluginArgs('install', 'dev', './bundle'),
    ['plugin', '--profile', 'dev', 'add', './bundle'],
  )
  assert.deepEqual(
    createPluginArgs('uninstall', 'web', 'dsh-devkit-core'),
    ['plugin', '--profile', 'web', 'remove', 'dsh-devkit-core'],
  )
})

test('doctor accepts the pinned npx fallback when dsh is not on PATH', async () => {
  let output = ''
  const status = await runApp(
    { command: 'doctor' },
    {
      stdout: { write: chunk => { output += chunk } },
      stderr: { write() {} },
      commandExists: command => command === 'npx',
    },
  )

  assert.equal(status, 0)
  assert.match(output, /✓ DeepSeek Harness: via npx @deepseek-ai\/dsh@0\.1\.0-rc\.5/)
  assert.doesNotMatch(output, /✗ dsh/)
})

test('doctor reports dsh on PATH when the global CLI is available', async () => {
  let output = ''
  const status = await runApp(
    { command: 'doctor' },
    {
      stdout: { write: chunk => { output += chunk } },
      stderr: { write() {} },
      commandExists: command => command === 'dsh' || command === 'npx',
    },
  )

  assert.equal(status, 0)
  assert.match(output, /✓ DeepSeek Harness: dsh on PATH/)
})
