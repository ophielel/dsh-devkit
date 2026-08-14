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

test('doctor accepts the unversioned npx fallback when dsh is not on PATH', async () => {
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
  assert.match(output, /^✓ DeepSeek Harness: via npx @deepseek-ai\/dsh$/m)
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

test('launch starts the selected Harness profile without inheriting the DeepSeek API key', async () => {
  let observed
  const sourceEnv = { PATH: 'bin', DeepSeek_Api_Key: 'secret', KEEP: 'value' }
  const status = await runApp(
    { command: 'launch', profile: 'web', harness: undefined, dryRun: false },
    {
      env: sourceEnv,
      harnessRunner(harness, args, options) {
        observed = { harness, args, options }
        return { status: 0 }
      },
    },
  )

  assert.equal(status, 0)
  assert.equal(observed.harness, undefined)
  assert.deepEqual(observed.args, ['--profile', 'web'])
  assert.deepEqual(observed.options.env, { PATH: 'bin', KEEP: 'value' })
  assert.equal(observed.options.dryRun, false)
  assert.equal(sourceEnv.DeepSeek_Api_Key, 'secret')
})
