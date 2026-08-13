const MODULES = ['github', 'browser', 'runtime']

const PREFIX_BY_MODULE = {
  github: 'mcp__github__',
  browser: 'mcp__browser__',
  runtime: 'cordis_',
}

export function installCapabilityScopes(ctx) {
  const states = new WeakMap()

  ctx.effect(() => ctx.tools.register({
    name: 'devkit_capability',
    description: 'Enable or disable one installed DevKit integration for this task only. Load the matching setup skill first. Enabled tools are hidden again when the current turn ends.',
    parameters: {
      type: 'object',
      properties: {
        module: { type: 'string', enum: MODULES, description: 'Integration to expose for the current task.' },
        enabled: { type: 'boolean', description: 'Whether the integration should be visible.' },
      },
      required: ['module', 'enabled'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, execution) {
      if (execution.agent === undefined) throw new Error('devkit_capability 只能在 Harness 会话作用域内使用')
      if (!MODULES.includes(args.module) || typeof args.enabled !== 'boolean') {
        throw new Error('无效的 DevKit capability 参数')
      }
      const state = stateFor(execution.agent)
      const wasEnabled = state.enabled.has(args.module)
      if (args.enabled) state.enabled.add(args.module)
      else state.enabled.delete(args.module)
      try {
        refresh(execution.agent, state)
      } catch (error) {
        if (wasEnabled) state.enabled.add(args.module)
        else state.enabled.delete(args.module)
        throw error
      }
      return `已为当前任务${args.enabled ? '启用' : '停用'} ${args.module}；当前 turn 结束后会自动恢复默认隐藏。`
    },
  }))
  ctx.effect(() => ctx.tools.guard(execution => {
    if (execution.agent === undefined) return undefined
    const module = moduleForToolName(String(execution.name ?? ''))
    if (module === undefined || stateFor(execution.agent).enabled.has(module)) return undefined
    return `DevKit ${module} 工具未为当前任务启用；先加载对应 Skill 并调用 devkit_capability。`
  }))

  ctx.on('agent/created', ({ agent }) => {
    refresh(agent, stateFor(agent))
  })
  ctx.on('agent/disposed', ({ agent }) => {
    const state = states.get(agent)
    state?.lift?.()
    states.delete(agent)
  })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    const agent = ctx.agents.get(session.id)
    if (agent === undefined) return
    const state = stateFor(agent)
    if (state.enabled.size === 0) return
    state.enabled.clear()
    refresh(agent, state)
  })
  ctx.on('tools/change', () => {
    for (const agent of ctx.agents.list()) refresh(agent, stateFor(agent))
  })

  for (const agent of ctx.agents.list()) refresh(agent, stateFor(agent))

  function stateFor(agent) {
    let state = states.get(agent)
    if (state === undefined) {
      state = { enabled: new Set(), deniedKey: undefined, lift: undefined, refreshing: false }
      states.set(agent, state)
    }
    return state
  }

  function refresh(agent, state) {
    if (state.refreshing) return
    const denied = hiddenToolNames(ctx.tools.schemas(), state.enabled)
    const deniedKey = denied.join('\n')
    if (state.deniedKey === deniedKey) return
    state.refreshing = true
    try {
      const previousLift = state.lift
      const nextLift = denied.length === 0 ? undefined : agent.ctx.tools.restrict({ deny: denied })
      state.lift = nextLift
      state.deniedKey = deniedKey
      previousLift?.()
    } finally {
      state.refreshing = false
    }
  }
}

export function hiddenToolNames(schemas, enabled = new Set()) {
  const hiddenPrefixes = MODULES
    .filter(module => !enabled.has(module))
    .map(module => PREFIX_BY_MODULE[module])
  return schemas
    .map(schema => schema.name)
    .filter(name => hiddenPrefixes.some(prefix => name.startsWith(prefix)))
    .sort()
}

function moduleForToolName(name) {
  return MODULES.find(module => name.startsWith(PREFIX_BY_MODULE[module]))
}
