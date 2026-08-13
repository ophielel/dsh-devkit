import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, inject, name } from '../index.js'

test('core plugin registers every skill and delegates safe tool calls', async () => {
  const registered = []
  let listener
  const ctx = {
    skills: { register(skill) { registered.push(skill); return () => {} } },
    effect(factory) { return factory() },
    on(event, callback) { assert.equal(event, 'tools/pre-execute'); listener = callback; return () => {} },
  }
  apply(ctx)
  assert.equal(name, 'dsh-devkit-core')
  assert.deepEqual(inject, ['skills', 'tools'])
  assert.equal(registered.length, 9)
  assert.deepEqual(await listener({ name: 'bash', arguments: { command: 'git status' } }, async () => ({ kind: 'allow' })), { kind: 'allow' })
})

test('core plugin routes classified high-risk calls through Harness approval', async () => {
  let listener
  const ctx = {
    skills: { register() { return () => {} } },
    effect(factory) { return factory() },
    on(_event, callback) { listener = callback; return () => {} },
  }
  apply(ctx)
  const decision = await listener(
    { name: 'mcp__github__merge_pull_request', arguments: {} },
    async () => ({ kind: 'allow' }),
  )
  assert.equal(decision.kind, 'ask')
  assert.match(decision.reason, /GitHub 写操作/)
})
