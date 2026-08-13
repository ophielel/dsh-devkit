import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

function setup(agents = []) {
  const listeners = new Map()
  const registeredTools = []
  const guards = []
  const globalNames = [
    'read',
    'mcp__github__get_file_contents',
    'mcp__browser__browser_snapshot',
    'cordis_inspect_list',
    'cordis_run',
  ]
  const ctx = {
    agents: {
      list: () => agents,
      get: id => agents.find(agent => agent.session.id === id),
    },
    skills: { register: () => () => {} },
    tools: {
      guard(callback) { guards.push(callback); return () => {} },
      register(tool) { registeredTools.push(tool); globalNames.push(tool.name); return () => {} },
      schemas: () => globalNames.map(name => ({ name })),
    },
    effect(factory) { return factory() },
    on(event, callback) { listeners.set(event, callback); return () => {} },
  }
  apply(ctx)
  return { agents, guards, listeners, registeredTools }
}

function createAgent(id = 'agent-1', { failRestrictionAt } = {}) {
  const restrictions = []
  const lifted = []
  let calls = 0
  const agent = {
    session: { id },
    ctx: {
      tools: {
        restrict(filter) {
          calls += 1
          if (calls === failRestrictionAt) throw new Error('restriction race')
          restrictions.push(filter)
          const index = restrictions.length - 1
          return () => { lifted.push(index) }
        },
      },
    },
  }
  return { agent, restrictions, lifted }
}

test('heavy integration tools start hidden and one small activation tool stays visible', () => {
  const { listeners, registeredTools } = setup()
  const { agent, restrictions } = createAgent()

  listeners.get('agent/created')({ agent })

  assert.equal(registeredTools.length, 1)
  assert.equal(registeredTools[0].name, 'devkit_capability')
  assert.deepEqual(restrictions.at(-1), {
    deny: [
      'cordis_inspect_list',
      'cordis_run',
      'mcp__browser__browser_snapshot',
      'mcp__github__get_file_contents',
    ],
  })
})

test('late plugin activation restricts agents that are already live', () => {
  const existing = createAgent('existing')
  setup([existing.agent])
  assert.match(existing.restrictions.at(-1).deny.join(','), /mcp__github__/)
  assert.match(existing.restrictions.at(-1).deny.join(','), /mcp__browser__/)
  assert.match(existing.restrictions.at(-1).deny.join(','), /cordis_/)
})

test('capability activation is scoped to one agent and resets at every durable turn end', async () => {
  const { agents, guards, listeners, registeredTools } = setup()
  const first = createAgent('agent-1')
  const second = createAgent('agent-2')
  agents.push(first.agent, second.agent)
  listeners.get('agent/created')({ agent: first.agent })
  listeners.get('agent/created')({ agent: second.agent })

  const tool = registeredTools.find(candidate => candidate.name === 'devkit_capability')
  const visibilityGuard = guards.find(guard => guard({ name: 'mcp__github__get_file_contents', agent: first.agent }) !== undefined)
  assert.match(visibilityGuard({ name: 'mcp__github__get_file_contents', agent: first.agent }), /未为当前任务启用/)
  const message = await tool.execute(
    { module: 'github', enabled: true },
    { agent: first.agent },
  )

  assert.match(message, /当前任务启用 github/)
  assert.equal(visibilityGuard({ name: 'mcp__github__get_file_contents', agent: first.agent }), undefined)
  assert.doesNotMatch(first.restrictions.at(-1).deny.join(','), /mcp__github__/)
  assert.match(second.restrictions.at(-1).deny.join(','), /mcp__github__/)

  listeners.get('session/event')(first.agent.session, { type: 'turn/end' })
  assert.match(first.restrictions.at(-1).deny.join(','), /mcp__github__/)
  assert.match(visibilityGuard({ name: 'mcp__github__get_file_contents', agent: first.agent }), /未为当前任务启用/)
})

test('capability activation fails closed without an agent scope', async () => {
  const { registeredTools } = setup()
  const tool = registeredTools.find(candidate => candidate.name === 'devkit_capability')
  await assert.rejects(
    tool.execute({ module: 'browser', enabled: true }, {}),
    /会话作用域/,
  )
})

test('a failed restriction refresh keeps the previous restriction active', async () => {
  const guarded = createAgent('guarded', { failRestrictionAt: 2 })
  const { agents, listeners, registeredTools } = setup([guarded.agent])
  assert.equal(agents.length, 1)
  const tool = registeredTools.find(candidate => candidate.name === 'devkit_capability')

  await assert.rejects(
    tool.execute({ module: 'github', enabled: true }, { agent: guarded.agent }),
    /restriction race/,
  )
  assert.deepEqual(guarded.lifted, [])
  listeners.get('tools/change')()
  assert.match(guarded.restrictions.at(-1).deny.join(','), /mcp__github__/)
})
