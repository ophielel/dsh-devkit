import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULTS,
  OPTION_CONTINUE,
  OPTION_DISABLE,
  OPTION_STOP,
  QUESTION_OPTIONS,
  REVIEW_SCHEMA,
  apply,
  boundSummary,
  buildReviewBrief,
  buildReviewPrompt,
  burnTokens,
  inject,
  name,
  normalizeConfig,
  pruneWindow,
  renderEventLine,
  windowSum,
} from '../index.js'

const NOW = Date.now()
const MINUTE = 60_000

function usageEvent(seq, time, usage) {
  return {
    seq,
    time,
    type: 'assistant/message',
    data: { turn: 1, step: seq, message: { role: 'assistant', content: [{ type: 'text', text: `reply ${seq}` }] }, usage },
  }
}

function stepStartEvent(seq, time) {
  return { seq, time, type: 'step/start', data: { turn: 1, step: 1 } }
}

function toolCallEvent(seq, time, toolName) {
  return { seq, time, type: 'tool/call', data: { turn: 1, step: 1, callId: `c${seq}`, name: toolName, arguments: '{}' } }
}

function createFakeCtx({ agents = [], subagents, userQuestions, schemas = [] } = {}) {
  const listeners = {}
  const registeredTools = []
  const log = []
  const ctx = {
    agents: {
      roots: () => agents.filter(agent => agent.root),
      get: id => agents.find(agent => agent.id === id),
    },
    tools: {
      register(definition) { registeredTools.push(definition); return () => {} },
      schemas: () => schemas,
    },
    get(serviceName) {
      if (serviceName === 'subagents') return subagents
      if (serviceName === 'userQuestions') return userQuestions
      return undefined
    },
    logger: { info: (...args) => log.push(['info', ...args]), warn: (...args) => log.push(['warn', ...args]) },
    effect(factory) { return factory() },
    on(event, callback) { (listeners[event] ??= []).push(callback); return () => {} },
    emit(event, ...args) { for (const callback of listeners[event] ?? []) callback(...args) },
    registeredTools,
    log,
  }
  return ctx
}

function createFakeAgent(id, events, { root = true, header } = {}) {
  const calls = []
  const messages = []
  const injects = []
  return {
    id,
    root,
    session: { id, events, header },
    cancel(cause, options) { calls.push(['cancel', cause, options]) },
    followup(message) { messages.push(message) },
    inject(message) { injects.push(message) },
    calls,
    messages,
    injects,
  }
}

function createFakeSubagents({ structured, fail = false, deferred = false } = {}) {
  const starts = []
  let settle
  const result = deferred
    ? new Promise(resolve => { settle = structured => resolve({ stopReason: 'completed', structured }) })
    : Promise.resolve({
        stopReason: 'completed',
        structured: structured ?? { verdict: 'normal', reason: '任务规模匹配', evidence: ['示例证据'] },
      })
  return {
    starts,
    settle,
    getProvider(named) { return named === 'spawn' ? {} : undefined },
    async start(providerName, request) {
      starts.push({ providerName, request })
      if (fail) throw new Error('subagent boom')
      return { id: 'review-1', result, dispose: async () => {} }
    },
  }
}

function createFakeUserQuestions({ selected = [OPTION_CONTINUE], fail = false } = {}) {
  const asks = []
  return {
    asks,
    async ask(request) {
      asks.push(request)
      if (fail) throw new Error('no ui')
      return { answers: [{ id: request.questions[0].id, selected }] }
    },
  }
}

function flush() {
  return new Promise(resolve => setImmediate(resolve))
}

test('plugin identity and dependencies', () => {
  assert.equal(name, 'dsh-devkit-token-watch')
  assert.deepEqual(inject, ['agents', 'tools'])
})

test('burnTokens counts marginal burn without cache reads', () => {
  assert.equal(burnTokens({ inputTokens: 100, outputTokens: 40, cacheWriteTokens: 20, cacheReadTokens: 9_999 }), 160)
  assert.equal(burnTokens({ inputTokens: 1, outputTokens: 2 }), 3)
  assert.equal(burnTokens(undefined), 0)
})

test('pruneWindow drops stale entries and caps retained length', () => {
  const entries = [
    { time: NOW - 2 * MINUTE, tokens: 1 },
    { time: NOW - MINUTE, tokens: 2 },
    { time: NOW, tokens: 3 },
  ]
  const pruned = pruneWindow(entries, NOW, 10 * MINUTE)
  assert.equal(pruned.length, 3)
  assert.deepEqual(pruneWindow(entries, NOW, 90_000), entries.slice(1))
  assert.equal(windowSum(pruned), 6)
  const many = Array.from({ length: 700 }, (_, index) => ({ time: NOW, tokens: 1 }))
  assert.equal(pruneWindow(many, NOW, 10 * MINUTE).length, 500)
})

test('normalizeConfig applies defaults and clamps numeric fields', () => {
  assert.deepEqual(normalizeConfig(undefined), DEFAULTS)
  assert.equal(normalizeConfig({ enabled: false }).enabled, false)
  assert.equal(normalizeConfig({ windowMs: 30_000 }).windowMs, 60_000)
  assert.equal(normalizeConfig({ thresholdTokens: 42 }).thresholdTokens, 1_000)
  assert.equal(normalizeConfig({ cooldownMs: 'x' }).cooldownMs, DEFAULTS.cooldownMs)
  assert.equal(normalizeConfig({ checkIntervalMs: -1 }).checkIntervalMs, 0)
  // A hard stop below the trigger threshold is clamped up to the threshold.
  assert.equal(normalizeConfig({ hardStopTokens: 1 }).hardStopTokens, DEFAULTS.thresholdTokens)
  assert.equal(normalizeConfig({ thresholdTokens: 500_000, hardStopTokens: 1_000 }).hardStopTokens, 500_000)
})

test('boundSummary caps at 120 chars', () => {
  assert.equal(boundSummary('短消息'), '短消息')
  assert.equal(boundSummary('x'.repeat(200)).length, 120)
})

test('renderEventLine renders messages, tool calls and results only', () => {
  const assistant = usageEvent(1, NOW, { inputTokens: 10, outputTokens: 5 })
  assert.match(renderEventLine(assistant), /\[助手\] reply 1（本步 15 tokens）/u)
  assert.match(renderEventLine(toolCallEvent(2, NOW, 'read')), /\[工具调用\] read\(/u)
  assert.equal(renderEventLine({ seq: 3, time: NOW, type: 'turn/start', data: { turn: 1 } }), undefined)
})

test('buildReviewBrief aggregates stats, task instruction and char cap', () => {
  const events = [
    { seq: 0, time: NOW - 2 * MINUTE, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '请完成这个重构' }] } },
    { seq: 1, time: NOW - MINUTE, type: 'step/start', data: { turn: 1, step: 1 } },
    usageEvent(2, NOW - 30_000, { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 30 }),
    toolCallEvent(3, NOW - 20_000, 'read'),
    toolCallEvent(4, NOW - 10_000, 'read'),
    { seq: 5, time: NOW, type: 'step/start', data: { turn: 1, step: 2 } },
  ]
  const brief = buildReviewBrief({ id: 's1', events }, NOW - 90_000)
  assert.equal(brief.sessionId, 's1')
  assert.equal(brief.stats.steps, 2)
  assert.equal(brief.stats.toolCalls, 2)
  assert.deepEqual(brief.stats.tools, { read: 2 })
  assert.equal(brief.stats.outputTokens, 50)
  assert.equal(brief.stats.cacheWriteTokens, 30)
  assert.equal(brief.stats.uncachedInputTokens, 100)
  assert.equal(brief.stats.largest, 180)
  assert.match(brief.firstUser, /请完成这个重构/u)
  assert.match(brief.contextLine, /请完成这个重构/u)
  assert.equal(brief.lines.length, 3)

  const tiny = buildReviewBrief({ id: 's1', events }, NOW - 90_000, { briefCharLimit: 10 })
  assert.match(tiny.lines.at(-1), /截断/u)
})

test('buildReviewPrompt carries stats and mode-specific framing', () => {
  const brief = buildReviewBrief({ id: 's1', events: [usageEvent(0, NOW, { inputTokens: 10, outputTokens: 5 })] }, NOW - 60_000)
  const usage = buildReviewPrompt(brief, DEFAULTS, { mode: 'usage', sum: 15 })
  assert.match(usage, /token 消耗审计员/u)
  assert.match(usage, /累计消耗 15 个 token/u)
  assert.match(usage, /主任务没有被暂停/u)
  assert.match(usage, /不要以工具调用结尾/u)

  const progress = buildReviewPrompt(brief, { ...DEFAULTS, checkIntervalMs: 30 * 60_000 }, { mode: 'progress' })
  assert.match(progress, /进度审计员/u)
  assert.match(progress, /钻牛角尖/u)
  assert.doesNotMatch(progress, /累计消耗/u)
})

test('apply registers the token_watch tool and honors toggles', () => {
  const ctx = createFakeCtx({ agents: [], subagents: createFakeSubagents(), userQuestions: createFakeUserQuestions() })
  apply(ctx, {})
  const tool = ctx.registeredTools.find(definition => definition.name === 'token_watch')
  assert.ok(tool)
  assert.match(tool.execute({}), /已开启/u)
  assert.match(tool.execute({ enabled: false }), /已关闭/u)
  assert.match(tool.execute({ enabled: true, thresholdTokens: 500_000, hardStopTokens: 900_000 }), /阈值 500000；硬停 900000/u)
  assert.match(tool.execute({ checkIntervalMs: 0 }), /进度检查 关闭/u)
  assert.match(tool.execute({ thresholdTokens: 1 }), /阈值 1000/u)
})

test('threshold crossing reviews in parallel without halting when normal', async () => {
  const events = []
  const agent = createFakeAgent('s1', events)
  const subagents = createFakeSubagents({ structured: { verdict: 'normal', reason: '大文件处理', evidence: ['read ×5'] } })
  const userQuestions = createFakeUserQuestions()
  const ctx = createFakeCtx({ agents: [agent], subagents, userQuestions, schemas: [{ name: 'bash' }] })
  apply(ctx, { thresholdTokens: 1_000 })

  events.push(usageEvent(0, NOW - 60_000, { inputTokens: 1_200, outputTokens: 300 }))
  ctx.emit('session/event', agent.session, events[0])
  await flush()

  assert.equal(agent.calls.length, 0)
  assert.equal(agent.messages.length, 0)
  assert.equal(subagents.starts.length, 1)
  const start = subagents.starts[0]
  assert.equal(start.providerName, 'spawn')
  assert.equal(start.request.label, 'token-watch-review')
  assert.equal(start.request.maxDepth, 1)
  assert.deepEqual(start.request.outputSchema, REVIEW_SCHEMA)
  assert.equal(start.request.toolFilter, undefined)
  assert.equal(start.request.parent, agent)
  assert.match(start.request.prompt[0].text, /主任务没有被暂停/u)
  assert.equal(userQuestions.asks.length, 0)
})

test('abnormal verdict halts and asks the user; continue resumes', async () => {
  const events = []
  const agent = createFakeAgent('s1', events)
  const subagents = createFakeSubagents({ structured: { verdict: 'abnormal', reason: '重复读取同一文件', evidence: ['read 连续调用 12 次'] } })
  const userQuestions = createFakeUserQuestions({ selected: [OPTION_CONTINUE] })
  const ctx = createFakeCtx({ agents: [agent], subagents, userQuestions })
  apply(ctx, { thresholdTokens: 1_000 })

  events.push(usageEvent(0, NOW - 30_000, { inputTokens: 900, outputTokens: 300 }))
  ctx.emit('session/event', agent.session, events[0])
  await flush()

  assert.equal(agent.calls.length, 1)
  assert.equal(agent.calls[0][0], 'cancel')
  assert.equal(agent.calls[0][1].kind, 'hook')
  assert.match(agent.calls[0][1].reason, /判定异常/u)
  assert.deepEqual(agent.calls[0][2], { keepInbox: true })

  assert.equal(userQuestions.asks.length, 1)
  assert.equal(userQuestions.asks[0].agent, agent)
  const question = userQuestions.asks[0].questions[0]
  assert.equal(question.header, 'Token Watch 审查')
  assert.match(question.detail, /重复读取同一文件/u)
  assert.deepEqual(question.options.map(option => option.label), [OPTION_CONTINUE, OPTION_STOP, OPTION_DISABLE])
  assert.equal(agent.messages.length, 1)
  assert.match(agent.messages[0].content[0].text, /用户已知悉消耗审查结果并选择继续/u)
})

test('user can stop the task or disable the feature through the dialog', async () => {
  const events = []
  const agent = createFakeAgent('s1', events)
  const subagents = createFakeSubagents({ structured: { verdict: 'abnormal', reason: '失控输出' } })
  const userQuestions = createFakeUserQuestions({ selected: [OPTION_STOP] })
  const ctx = createFakeCtx({ agents: [agent], subagents, userQuestions })
  apply(ctx, { thresholdTokens: 1_000 })
  events.push(usageEvent(0, NOW - 30_000, { inputTokens: 900, outputTokens: 300 }))
  ctx.emit('session/event', agent.session, events[0])
  await flush()
  // Stop must NOT wake the driver: the notice goes through inject, the agent
  // stays idle until the user writes something new.
  assert.equal(agent.messages.length, 0)
  assert.equal(agent.injects.length, 1)
  assert.match(agent.injects[0].content[0].text, /决定停止当前任务/u)

  const disabledCtx = createFakeCtx({ agents: [], subagents: createFakeSubagents({ structured: { verdict: 'abnormal', reason: '失控输出' } }), userQuestions: createFakeUserQuestions({ selected: [OPTION_DISABLE] }) })
  apply(disabledCtx, { thresholdTokens: 1_000 })
  const disabledAgent = createFakeAgent('s2', [])
  disabledCtx.agents.roots = () => [disabledAgent]
  disabledCtx.agents.get = id => (id === 's2' ? disabledAgent : undefined)
  disabledAgent.session.events.push(usageEvent(0, NOW - 30_000, { inputTokens: 900, outputTokens: 300 }))
  disabledCtx.emit('session/event', disabledAgent.session, disabledAgent.session.events[0])
  await flush()
  assert.match(disabledAgent.messages[0].content[0].text, /用户已关闭本功能/u)
  const tool = disabledCtx.registeredTools.find(definition => definition.name === 'token_watch')
  assert.match(tool.execute({}), /已关闭/u)
})

test('hard stop halts immediately while a review is in flight, then resumes on normal verdict', async () => {
  const events = []
  const agent = createFakeAgent('s1', events)
  const subagents = createFakeSubagents({ deferred: true })
  const userQuestions = createFakeUserQuestions()
  const ctx = createFakeCtx({ agents: [agent], subagents, userQuestions })
  apply(ctx, { thresholdTokens: 1_000, hardStopTokens: 2_000 })

  events.push(usageEvent(0, NOW - 60_000, { inputTokens: 1_200, outputTokens: 300 }))
  ctx.emit('session/event', agent.session, events[0])
  await flush()
  assert.equal(subagents.starts.length, 1)
  assert.equal(agent.calls.length, 0)

  events.push(usageEvent(1, NOW, { inputTokens: 2_000, outputTokens: 2_000 }))
  ctx.emit('session/event', agent.session, events[1])
  assert.equal(agent.calls.length, 1)
  assert.match(agent.calls[0][1].reason, /硬停线/u)

  subagents.settle({ verdict: 'normal', reason: '任务规模匹配', evidence: [] })
  await flush()
  assert.equal(agent.messages.length, 1)
  assert.match(agent.messages[0].content[0].text, /判定为正常行为.*已恢复任务/u)
  assert.equal(userQuestions.asks.length, 0)
})

test('first crossing at or above hard stop halts immediately and still asks on abnormal', async () => {
  const events = []
  const agent = createFakeAgent('s1', events)
  const subagents = createFakeSubagents({ structured: { verdict: 'abnormal', reason: '失控消耗' } })
  const userQuestions = createFakeUserQuestions({ selected: [OPTION_CONTINUE] })
  const ctx = createFakeCtx({ agents: [agent], subagents, userQuestions })
  apply(ctx, { thresholdTokens: 1_000, hardStopTokens: 2_000 })

  events.push(usageEvent(0, NOW - 30_000, { inputTokens: 1_500, outputTokens: 800 }))
  ctx.emit('session/event', agent.session, events[0])
  await flush()

  assert.equal(agent.calls.length, 1)
  assert.match(agent.calls[0][1].reason, /已达硬停线/u)
  assert.equal(userQuestions.asks.length, 1)
})

test('periodic progress check reviews long sessions for rabbit-holing', async () => {
  const events = []
  const agent = createFakeAgent('s1', events, { header: { createdAt: NOW - 40 * MINUTE } })
  const subagents = createFakeSubagents({ structured: { verdict: 'abnormal', reason: '反复尝试同一失败方案', evidence: ['同一条 bash 命令执行 6 次'] } })
  const userQuestions = createFakeUserQuestions({ selected: [OPTION_STOP] })
  const ctx = createFakeCtx({ agents: [agent], subagents, userQuestions })
  apply(ctx, { checkIntervalMs: 30 * MINUTE })

  events.push(stepStartEvent(0, NOW))
  ctx.emit('session/event', agent.session, events[0])
  await flush()

  assert.equal(subagents.starts.length, 1)
  assert.equal(subagents.starts[0].request.label, 'token-watch-progress')
  assert.match(subagents.starts[0].request.prompt[0].text, /进度审计员/u)
  assert.equal(agent.calls.length, 1)
  assert.match(agent.calls[0][1].reason, /判定异常/u)
  assert.equal(userQuestions.asks.length, 1)
  assert.match(userQuestions.asks[0].questions[0].question, /进度审查判定异常/u)
  assert.equal(agent.messages.length, 0)
  assert.equal(agent.injects.length, 1)
  assert.match(agent.injects[0].content[0].text, /决定停止当前任务/u)
})

test('periodic check is silent on normal verdict and when review is unavailable', async () => {
  const events = []
  const agent = createFakeAgent('s1', events, { header: { createdAt: NOW - 40 * MINUTE } })
  const subagents = createFakeSubagents({ structured: { verdict: 'normal', reason: '进展正常' } })
  const ctx = createFakeCtx({ agents: [agent], subagents, userQuestions: createFakeUserQuestions() })
  apply(ctx, { checkIntervalMs: 30 * MINUTE })

  events.push(stepStartEvent(0, NOW))
  ctx.emit('session/event', agent.session, events[0])
  await flush()
  assert.equal(agent.calls.length, 0)
  assert.equal(agent.messages.length, 0)

  const events2 = []
  const agent2 = createFakeAgent('s2', events2, { header: { createdAt: NOW - 40 * MINUTE } })
  const ctx2 = createFakeCtx({ agents: [agent2], subagents: undefined, userQuestions: createFakeUserQuestions() })
  apply(ctx2, { checkIntervalMs: 30 * MINUTE })
  events2.push(stepStartEvent(0, NOW))
  ctx2.emit('session/event', agent2.session, events2[0])
  await flush()
  assert.equal(agent2.calls.length, 0)
  assert.equal(agent2.messages.length, 0)
})

test('non-root sessions and disabled feature are ignored', async () => {
  const root = createFakeAgent('root', [])
  const child = createFakeAgent('child', [], { root: false })
  const ctx = createFakeCtx({ agents: [root, child], subagents: createFakeSubagents(), userQuestions: createFakeUserQuestions() })
  apply(ctx, { thresholdTokens: 1_000 })

  child.session.events.push(usageEvent(0, NOW - 30_000, { inputTokens: 600, outputTokens: 600 }))
  ctx.emit('session/event', child.session, child.session.events[0])
  await flush()
  assert.equal(child.calls.length, 0)
  assert.equal(child.messages.length, 0)

  const tool = ctx.registeredTools.find(definition => definition.name === 'token_watch')
  tool.execute({ enabled: false })
  root.session.events.push(usageEvent(1, NOW - 30_000, { inputTokens: 600, outputTokens: 600 }))
  ctx.emit('session/event', root.session, root.session.events[1])
  await flush()
  assert.equal(root.calls.length, 0)
})

test('cooldown suppresses a second usage review right after a trigger', async () => {
  const events = []
  const agent = createFakeAgent('s1', events)
  const subagents = createFakeSubagents()
  const ctx = createFakeCtx({ agents: [agent], subagents, userQuestions: createFakeUserQuestions() })
  apply(ctx, { thresholdTokens: 1_000 })

  events.push(usageEvent(0, NOW - 60_000, { inputTokens: 1_200, outputTokens: 300 }))
  ctx.emit('session/event', agent.session, events[0])
  await flush()
  events.push(usageEvent(1, NOW, { inputTokens: 2_000, outputTokens: 2_000 }))
  ctx.emit('session/event', agent.session, events[1])
  await flush()
  assert.equal(subagents.starts.length, 1)
})

test('missing subagent service falls back to asking the user directly in usage mode', async () => {
  const events = []
  const agent = createFakeAgent('s1', events)
  const userQuestions = createFakeUserQuestions({ selected: [OPTION_CONTINUE] })
  const ctx = createFakeCtx({ agents: [agent], subagents: undefined, userQuestions })
  apply(ctx, { thresholdTokens: 1_000 })

  events.push(usageEvent(0, NOW - 30_000, { inputTokens: 900, outputTokens: 300 }))
  ctx.emit('session/event', agent.session, events[0])
  await flush()

  assert.equal(userQuestions.asks.length, 1)
  assert.equal(agent.messages.length, 1)
  assert.match(agent.messages[0].content[0].text, /用户已知悉/u)
})

test('without a user-questions UI the pause notice is injected, never waking the model', async () => {
  const events = []
  const agent = createFakeAgent('s1', events)
  const ctx = createFakeCtx({ agents: [agent], subagents: undefined, userQuestions: undefined })
  apply(ctx, { thresholdTokens: 1_000 })

  events.push(usageEvent(0, NOW - 30_000, { inputTokens: 900, outputTokens: 300 }))
  ctx.emit('session/event', agent.session, events[0])
  await flush()

  assert.equal(agent.messages.length, 0)
  assert.equal(agent.injects.length, 1)
  assert.match(agent.injects[0].content[0].text, /保持暂停/u)
})

test('review failure and ask failure both fail open', async () => {
  const events = []
  const agent = createFakeAgent('s1', events)
  const subagents = createFakeSubagents({ fail: true })
  const userQuestions = createFakeUserQuestions()
  const ctx = createFakeCtx({ agents: [agent], subagents, userQuestions })
  apply(ctx, { thresholdTokens: 1_000 })

  events.push(usageEvent(0, NOW - 30_000, { inputTokens: 900, outputTokens: 300 }))
  ctx.emit('session/event', agent.session, events[0])
  await flush()
  assert.equal(userQuestions.asks.length, 1)
  assert.equal(agent.messages.length, 1)

  const brokenAsk = createFakeAgent('s2', [])
  const userQuestionsFail = createFakeUserQuestions({ fail: true })
  const ctx2 = createFakeCtx({ agents: [brokenAsk], subagents: createFakeSubagents({ structured: { verdict: 'abnormal', reason: 'x' } }), userQuestions: userQuestionsFail })
  apply(ctx2, { thresholdTokens: 1_000 })
  brokenAsk.session.events.push(usageEvent(0, NOW - 30_000, { inputTokens: 900, outputTokens: 300 }))
  ctx2.emit('session/event', brokenAsk.session, brokenAsk.session.events[0])
  await flush()
  assert.match(brokenAsk.messages[0].content[0].text, /任务已恢复/u)
})

test('apply replays existing root sessions on load without halting a finished turn', async () => {
  // Historical usage at or above the hard-stop line still only starts a
  // review on load — a freshly loaded plugin must not cancel an in-flight
  // turn before any verdict exists.
  const events = [usageEvent(0, NOW - 60_000, { inputTokens: 2_500, outputTokens: 1_000 })]
  const agent = createFakeAgent('s1', events)
  const subagents = createFakeSubagents()
  const ctx = createFakeCtx({ agents: [agent], subagents, userQuestions: createFakeUserQuestions() })
  apply(ctx, { thresholdTokens: 1_000, hardStopTokens: 2_000 })
  await flush()
  assert.equal(subagents.starts.length, 1)
  assert.equal(agent.calls.length, 0)

  // The same window observed live (non-seeded) does halt immediately.
  const events2 = []
  const agent2 = createFakeAgent('s2', events2)
  const ctx2 = createFakeCtx({ agents: [agent2], subagents: createFakeSubagents(), userQuestions: createFakeUserQuestions() })
  apply(ctx2, { thresholdTokens: 1_000, hardStopTokens: 2_000 })
  events2.push(usageEvent(0, NOW - 30_000, { inputTokens: 2_500, outputTokens: 1_000 }))
  ctx2.emit('session/event', agent2.session, events2[0])
  await flush()
  assert.equal(agent2.calls.length, 1)
  assert.match(agent2.calls[0][1].reason, /已达硬停线/u)
})
