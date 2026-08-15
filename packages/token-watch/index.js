/**
 * dsh-devkit-token-watch
 *
 * Windowed usage guard + periodic progress audit for DeepSeek Harness.
 *
 * Two independent observers run on root agent sessions only:
 *
 * 1. Usage observer (on `assistant/message` with provider usage): when the
 *    session burns more than `thresholdTokens` inside `windowMs`, a review
 *    subagent is spawned in the BACKGROUND — the agent keeps running and is
 *    never interrupted by the trigger itself. Only two things halt the turn:
 *    - the window keeps growing to `hardStopTokens` while a review is still
 *      in flight (or the first crossing is already at/above it), or
 *    - the review verdict is `abnormal`.
 * 2. Progress observer (on `step/start`): for long continuous work, every
 *    `checkIntervalMs` (default 30 min) of activity a progress review checks
 *    whether the model is going in circles / stuck in a rabbit hole.
 *
 * The review subagent is deliberately flexible: it receives the session's
 * original task instruction, a generous transcript summary, and full tool
 * access (approval stays pinned to `never` by the delegation policy, and the
 * run is bounded by `reviewTimeoutMs` / `reviewMaxTokens` / `maxDepth`), so
 * it can verify facts itself instead of judging a summary blindly. It must
 * still end with the structured `{ verdict, reason, evidence }` output.
 *
 * On an abnormal verdict the turn is halted and the user is asked through
 * `ctx.userQuestions` (continue / stop / disable). Normal verdicts resume
 * automatically when the guard had to stop the turn, and are logged
 * otherwise. Every failure path fails open: a broken review or ask never
 * strands a session. The `token_watch` tool toggles and tunes the feature.
 *
 * Plain ESM with no runtime dependencies (Node globals only).
 */

export const name = 'dsh-devkit-token-watch'
export const inject = ['agents', 'tools']

export const DEFAULTS = Object.freeze({
  enabled: true,
  windowMs: 10 * 60_000,
  thresholdTokens: 300_000,
  hardStopTokens: 600_000,
  cooldownMs: 5 * 60_000,
  checkIntervalMs: 30 * 60_000,
  reviewTimeoutMs: 120_000,
  reviewMaxTokens: 3_000,
  briefCharLimit: 80_000,
  lineCharLimit: 2_000,
})

const WINDOW_MIN_MS = 60_000
const WINDOW_MAX_MS = 24 * 3600_000
const TOKEN_MIN = 1_000
const TOKEN_MAX = 1_000_000_000
const CHECK_MIN_MS = 0
const CHECK_MAX_MS = 24 * 3600_000

/** Structured verdict the review subagent must produce. */
export const REVIEW_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['normal', 'abnormal'] },
    reason: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'reason', 'evidence'],
  additionalProperties: false,
})

export const OPTION_CONTINUE = '继续执行'
export const OPTION_STOP = '停止当前任务'
export const OPTION_DISABLE = '关闭 Token Watch 并继续'

export const QUESTION_OPTIONS = Object.freeze([
  Object.freeze({ label: OPTION_CONTINUE, description: '已知悉审查结果，恢复任务继续执行' }),
  Object.freeze({ label: OPTION_STOP, description: '保持暂停，不再继续执行；需要进展汇报可稍后直接提问' }),
  Object.freeze({ label: OPTION_DISABLE, description: '本次继续执行，并关闭该审查功能' }),
])

const NOTICE_SUMMARY_MAX_CHARS = 120

/**
 * Merge raw plugin config with defaults, clamping numeric fields.
 * @param raw - the config object from the plugin row, if any.
 * @returns a normalized settings object.
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const thresholdTokens = clampInt(source.thresholdTokens, TOKEN_MIN, TOKEN_MAX, DEFAULTS.thresholdTokens)
  return {
    enabled: source.enabled === undefined ? DEFAULTS.enabled : Boolean(source.enabled),
    windowMs: clampInt(source.windowMs, WINDOW_MIN_MS, WINDOW_MAX_MS, DEFAULTS.windowMs),
    thresholdTokens,
    // A hard stop below the trigger threshold is a contradiction (the first
    // crossing would already halt); enforce the invariant here.
    hardStopTokens: Math.max(clampInt(source.hardStopTokens, TOKEN_MIN, TOKEN_MAX, DEFAULTS.hardStopTokens), thresholdTokens),
    cooldownMs: clampInt(source.cooldownMs, 0, WINDOW_MAX_MS, DEFAULTS.cooldownMs),
    checkIntervalMs: clampInt(source.checkIntervalMs, CHECK_MIN_MS, CHECK_MAX_MS, DEFAULTS.checkIntervalMs),
    reviewTimeoutMs: clampInt(source.reviewTimeoutMs, 5_000, 600_000, DEFAULTS.reviewTimeoutMs),
    reviewMaxTokens: clampInt(source.reviewMaxTokens, 200, 10_000, DEFAULTS.reviewMaxTokens),
    briefCharLimit: clampInt(source.briefCharLimit, 1_000, 200_000, DEFAULTS.briefCharLimit),
    lineCharLimit: clampInt(source.lineCharLimit, 100, 4_000, DEFAULTS.lineCharLimit),
  }
}

/**
 * Marginal burn of one model call: uncached input plus newly cached context
 * plus generated output. Cache reads are cheap repetition of existing
 * context and deliberately excluded.
 */
export function burnTokens(usage) {
  if (usage === undefined || usage === null) return 0
  return (usage.inputTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0)
}

/**
 * Drop window entries older than `now - windowMs` and cap the retained list.
 * @param entries - `[{ time, tokens }]` in append order.
 * @param now - current epoch ms.
 * @param windowMs - window length in ms.
 * @returns a pruned copy (never mutates the input).
 */
export function pruneWindow(entries, now, windowMs) {
  const cutoff = now - windowMs
  const kept = entries.filter(entry => entry.time >= cutoff)
  return kept.length > 500 ? kept.slice(kept.length - 500) : kept
}

/** Sum tokens of window entries. */
export function windowSum(entries) {
  return entries.reduce((total, entry) => total + entry.tokens, 0)
}

/** Bound a notice summary to the harness `notice` form contract (120 chars). */
export function boundSummary(text) {
  return text.length <= NOTICE_SUMMARY_MAX_CHARS ? text : `${text.slice(0, NOTICE_SUMMARY_MAX_CHARS - 1)}…`
}

/** Compact single-line rendering of one session event for the review brief. */
export function renderEventLine(event, limit = 600) {
  switch (event.type) {
    case 'user/message':
      return `[用户] ${truncate(textOf(event.data.content), limit)}`
    case 'assistant/message': {
      const usage = event.data.usage
      const suffix = usage === undefined ? '' : `（本步 ${burnTokens(usage)} tokens）`
      return `[助手] ${truncate(textOf(event.data.message.content), limit)}${suffix}`
    }
    case 'tool/call':
      return `[工具调用] ${event.data.name}(${truncate(String(event.data.arguments ?? ''), limit)})`
    case 'tool/result':
      return `[工具结果] ${truncate(textOf(event.data.message.content), limit)}`
    default:
      return undefined
  }
}

/**
 * Build the review material for one session window: stats plus a compact
 * event summary, the original task instruction, and the last user message
 * before the window for context.
 * @param session - the live session (reads `events`, `id` and `header`).
 * @param windowStart - epoch ms marking the window start.
 * @param limits - optional `lineCharLimit` / `briefCharLimit`.
 * @returns `{ sessionId, lines, stats, firstUser, contextLine }`.
 */
export function buildReviewBrief(session, windowStart, limits = {}) {
  const lineCharLimit = limits.lineCharLimit ?? DEFAULTS.lineCharLimit
  const totalCharLimit = limits.briefCharLimit ?? DEFAULTS.briefCharLimit
  const stats = {
    steps: 0,
    toolCalls: 0,
    tools: {},
    largest: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    uncachedInputTokens: 0,
  }
  const lines = []
  let chars = 0
  let firstUser
  let lastUserBeforeWindow
  for (const event of session.events) {
    if (event.type === 'user/message') {
      if (firstUser === undefined) firstUser = event
      if (event.time < windowStart && (lastUserBeforeWindow === undefined || event.time > lastUserBeforeWindow.time)) {
        lastUserBeforeWindow = event
      }
      continue
    }
    if (event.time < windowStart) continue
    if (event.type === 'step/start') stats.steps += 1
    if (event.type === 'tool/call') {
      stats.toolCalls += 1
      stats.tools[event.data.name] = (stats.tools[event.data.name] ?? 0) + 1
    }
    if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      const usage = event.data.usage
      stats.outputTokens += usage.outputTokens ?? 0
      stats.cacheWriteTokens += usage.cacheWriteTokens ?? 0
      stats.uncachedInputTokens += usage.inputTokens ?? 0
      const total = burnTokens(usage)
      if (total > stats.largest) stats.largest = total
    }
    const line = renderEventLine(event, lineCharLimit)
    if (line === undefined) continue
    chars += line.length + 1
    if (chars > totalCharLimit) {
      lines.push('…（事件摘要已截断）')
      break
    }
    lines.push(line)
  }
  return {
    sessionId: session.id,
    lines,
    stats,
    firstUser: firstUser === undefined ? undefined : renderEventLine(firstUser, lineCharLimit),
    contextLine: lastUserBeforeWindow === undefined
      ? undefined
      : renderEventLine(lastUserBeforeWindow, lineCharLimit),
  }
}

/**
 * Build the review subagent prompt from a brief.
 * @param brief - output of {@link buildReviewBrief}.
 * @param settings - normalized settings (drives the framing numbers).
 * @param options - `{ mode: 'usage' | 'progress', sum? }`.
 */
export function buildReviewPrompt(brief, settings, { mode = 'usage', sum } = {}) {
  const windowMinutes = Math.max(1, Math.round(settings.windowMs / 60_000))
  const intervalMinutes = Math.max(1, Math.round(settings.checkIntervalMs / 60_000))
  const stats = brief.stats
  const toolBreakdown = Object.entries(stats.tools)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([toolName, count]) => `${toolName}×${count}`)
    .join('，') || '无'
  const lines = []
  if (mode === 'progress') {
    lines.push(
      '你是 Harness 的进度审计员，负责判断一个长时间连续工作的模型会话是否在钻牛角尖。',
      '',
      `背景：会话 ${brief.sessionId} 已持续工作，距上次检查约 ${intervalMinutes} 分钟。系统在后台并行审查，主任务没有被暂停。`,
      '',
      '请重点判断模型是否出现以下征兆：',
      '- 反复尝试同一失败方案（换汤不换药，连续多次类似失败后仍不换思路）',
      '- 重复读取同一文件/内容、重复执行同一操作，没有新信息产生',
      '- 长时间没有实质性进展（输出与当前任务无关、空转、过度纠缠细节）',
      '- 消耗与产出明显不成比例',
    )
  } else {
    lines.push(
      '你是 Harness 的 token 消耗审计员，负责判断一次高强度模型活动是否正常。',
      '',
      `背景：会话 ${brief.sessionId} 在最近 ${windowMinutes} 分钟内累计消耗 ${sum} 个 token（口径：inputTokens + cacheWriteTokens + outputTokens，不含缓存命中），超过阈值 ${settings.thresholdTokens}。审查在后台并行进行，主任务没有被暂停。`,
      '',
      '请判断这是正常行为还是不正常行为：',
      '- normal：高强度但合理的任务（如大文件处理、长文档生成、深度重构），消耗与任务规模匹配。',
      '- abnormal：异常行为，例如重复循环、反复读取同一内容、失控的长输出、无效重试、与当前任务无关的消耗。',
    )
  }
  lines.push(
    '',
    '窗口统计：',
    `- 模型步骤数：${stats.steps}`,
    `- 工具调用数：${stats.toolCalls}（${toolBreakdown}）`,
    `- 生成输出 tokens：${stats.outputTokens}`,
    `- 新写入缓存 tokens：${stats.cacheWriteTokens}`,
    `- 未命中缓存输入 tokens：${stats.uncachedInputTokens}`,
    `- 单步最大消耗：${stats.largest}`,
  )
  if (brief.firstUser !== undefined) lines.push('', '会话最初的任务指令：', brief.firstUser)
  if (brief.contextLine !== undefined) lines.push('', '窗口开始前的最后一条用户消息：', brief.contextLine)
  lines.push('', '窗口内事件摘要（越靠后越新）：')
  lines.push(...brief.lines)
  lines.push(
    '',
    '如需更多信息可以使用工具核实（如读取工作区文件），优先只读操作，不要执行修改性操作。',
    '最终必须直接输出结构化结论，不要以工具调用结尾。reason 用中文；evidence 列出 1-3 条具体证据（引用事件、工具或数字）。',
  )
  return lines.join('\n')
}

/**
 * Plugin entry. `ctx.agents` and `ctx.tools` are hard dependencies; the
 * `subagents` and `userQuestions` services are optional (`ctx.get`).
 */
export function apply(ctx, rawConfig) {
  const settings = normalizeConfig(rawConfig)
  const states = new WeakMap()
  const lifecycle = new AbortController()
  ctx.effect(() => () => lifecycle.abort())

  ctx.effect(() => ctx.tools.register({
    name: 'token_watch',
    description: '查询或调整 Token Watch：窗口内 token 消耗超限时后台并行审查、长时间工作定期检查是否钻牛角尖，判定异常时暂停并请用户裁决。',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: '是否启用该功能' },
        windowMs: { type: 'integer', description: `消耗统计窗口毫秒（默认 ${DEFAULTS.windowMs}）` },
        thresholdTokens: { type: 'integer', description: `窗口内触发审查的 token 阈值（默认 ${DEFAULTS.thresholdTokens}）` },
        hardStopTokens: { type: 'integer', description: `审查期间继续超限即暂停的硬停阈值（默认 ${DEFAULTS.hardStopTokens}）` },
        cooldownMs: { type: 'integer', description: `两次审查的最短间隔毫秒（默认 ${DEFAULTS.cooldownMs}）` },
        checkIntervalMs: { type: 'integer', description: `长时间工作的进度检查间隔毫秒，0 关闭（默认 ${DEFAULTS.checkIntervalMs}）` },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute(args) {
      if (args.enabled !== undefined) settings.enabled = Boolean(args.enabled)
      if (args.windowMs !== undefined) settings.windowMs = clampInt(args.windowMs, WINDOW_MIN_MS, WINDOW_MAX_MS, settings.windowMs)
      if (args.thresholdTokens !== undefined) settings.thresholdTokens = clampInt(args.thresholdTokens, TOKEN_MIN, TOKEN_MAX, settings.thresholdTokens)
      if (args.hardStopTokens !== undefined) settings.hardStopTokens = clampInt(args.hardStopTokens, TOKEN_MIN, TOKEN_MAX, settings.hardStopTokens)
      if (args.cooldownMs !== undefined) settings.cooldownMs = clampInt(args.cooldownMs, 0, WINDOW_MAX_MS, settings.cooldownMs)
      if (args.checkIntervalMs !== undefined) settings.checkIntervalMs = clampInt(args.checkIntervalMs, CHECK_MIN_MS, CHECK_MAX_MS, settings.checkIntervalMs)
      return `Token Watch：${settings.enabled ? '已开启' : '已关闭'}；窗口 ${Math.round(settings.windowMs / 60_000)} 分钟；阈值 ${settings.thresholdTokens}；硬停 ${settings.hardStopTokens}；审查冷却 ${Math.round(settings.cooldownMs / 60_000)} 分钟；进度检查 ${settings.checkIntervalMs === 0 ? '关闭' : `每 ${Math.round(settings.checkIntervalMs / 60_000)} 分钟`}。`
    },
  }))

  ctx.on('session/event', (session, event) => {
    if (!settings.enabled) return
    const agent = ctx.agents.get(session.id)
    if (agent === undefined || !ctx.agents.roots().includes(agent)) return
    if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      observeUsage(session, agent, event)
    } else if (event.type === 'step/start') {
      observeProgress(session, agent)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent.session)
  })

  // Catch up on sessions that already existed before this plugin loaded.
  // Historical events are replayed as `seeded`: they may trigger a review
  // (a window that already crossed the threshold is worth checking once) but
  // never halt the turn outright — the user just (re)loaded the plugin and
  // should not be interrupted mid-task before any verdict exists.
  for (const agent of ctx.agents.roots()) {
    stateFor(agent.session)
    for (const event of agent.session.events) {
      if (event.type === 'assistant/message' && event.data.usage !== undefined) observeUsage(agent.session, agent, event, true)
    }
  }

  function observeUsage(session, agent, event, seeded = false) {
    const state = stateFor(session)
    state.entries.push({ time: event.time, tokens: burnTokens(event.data.usage) })
    const now = Date.now()
    state.entries = pruneWindow(state.entries, now, settings.windowMs)
    const sum = windowSum(state.entries)
    if (state.reviewing) {
      // Hard stop: the burn continues past the safety line while a review is
      // in flight — stop the bleed now; the verdict decides what happens next.
      if (!seeded && !state.cancelledByGuard && sum >= settings.hardStopTokens) {
        cancel(agent, `token-watch: 审查期间窗口消耗达到 ${sum} tokens 硬停线，暂停`)
      }
      return
    }
    if (now - state.lastReviewAt < settings.cooldownMs) return
    if (sum < settings.thresholdTokens) return
    ctx.logger?.info?.(`token-watch: 会话 ${session.id} 窗口消耗 ${sum} tokens，后台审查`)
    startReview(agent, session, { mode: 'usage', sum, since: now - settings.windowMs, seeded })
  }

  function observeProgress(session, agent) {
    if (settings.checkIntervalMs <= 0) return
    const state = stateFor(session)
    if (state.reviewing) return
    const now = Date.now()
    if (state.lastPeriodicAt === 0) {
      // Anchor to the session's real start so a long-running session gets its
      // first check immediately instead of waiting a full interval.
      state.lastPeriodicAt = session.header?.createdAt ?? now
    }
    if (now - state.lastPeriodicAt < settings.checkIntervalMs) return
    const since = state.lastPeriodicAt
    state.lastPeriodicAt = now
    ctx.logger?.info?.(`token-watch: 会话 ${session.id} 进度检查（距上次 ${Math.round((now - since) / 60_000)} 分钟）`)
    startReview(agent, session, { mode: 'progress', since })
  }

  function stateFor(session) {
    let state = states.get(session)
    if (state === undefined) {
      state = { entries: [], reviewing: false, lastReviewAt: 0, lastPeriodicAt: 0, cancelledByGuard: false }
      states.set(session, state)
    }
    return state
  }

  function cancel(agent, reason) {
    const state = states.get(agent.session)
    if (state !== undefined) state.cancelledByGuard = true
    agent.cancel({ kind: 'hook', reason }, { keepInbox: true })
  }

  function startReview(agent, session, { mode, sum, since, seeded = false }) {
    const state = stateFor(session)
    if (state.reviewing) return
    state.reviewing = true
    if (mode === 'usage' && !seeded && sum >= settings.hardStopTokens && !state.cancelledByGuard) {
      cancel(agent, `token-watch: 窗口消耗 ${sum} tokens 已达硬停线，暂停并审查`)
    }
    void runReview(agent, session, state, { mode, sum, since }).finally(() => {
      state.reviewing = false
      state.lastReviewAt = Date.now()
    })
  }

  async function runReview(agent, session, state, { mode, sum, since }) {
    const brief = buildReviewBrief(session, since, settings)
    try {
      const verdict = await runReviewer(agent, brief, sum, mode)
      if (verdict === undefined || verdict.verdict === undefined) {
        // No review possible: usage mode still surfaces the trigger to the
        // user; progress mode has no hard evidence and stays silent.
        if (mode === 'usage') await askUser(agent, brief, sum, undefined, mode)
        else ctx.logger?.info?.(`token-watch: 进度审查不可用，跳过（会话 ${session.id}）`)
        return
      }
      if (verdict.verdict === 'normal') {
        if (state.cancelledByGuard) {
          state.cancelledByGuard = false
          resume(agent, `Token Watch：审查判定为正常行为（${verdict.reason ?? '无理由'}），已恢复任务。`)
        } else {
          ctx.logger?.info?.(`token-watch: 审查正常（会话 ${session.id}）：${verdict.reason ?? ''}`)
        }
        return
      }
      if (!state.cancelledByGuard) {
        cancel(agent, `token-watch: 审查判定异常（${verdict.reason ?? '无理由'}），暂停待用户裁决`)
      }
      await askUser(agent, brief, sum, verdict, mode)
    } catch (error) {
      ctx.logger?.warn?.(`token-watch: 审查流程失败：${errorMessage(error)}`)
      try {
        if (state.cancelledByGuard) {
          state.cancelledByGuard = false
          resume(agent, `Token Watch：审查流程失败（${errorMessage(error)}），任务已恢复。`)
        }
      } catch {
        // Agent may already be gone; nothing left to do.
      }
    }
  }

  async function runReviewer(agent, brief, sum, mode) {
    const subagents = ctx.get('subagents')
    if (subagents === undefined) return undefined
    const providerName = subagents.getProvider('spawn') !== undefined
      ? 'spawn'
      : subagents.getProvider('fork') !== undefined ? 'fork' : undefined
    if (providerName === undefined) return undefined
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), settings.reviewTimeoutMs)
    let run
    try {
      const signal = AbortSignal.any([lifecycle.signal, controller.signal])
      run = await subagents.start(providerName, {
        label: mode === 'progress' ? 'token-watch-progress' : 'token-watch-review',
        prompt: [{ type: 'text', text: buildReviewPrompt(brief, settings, { mode, sum }) }],
        parent: agent,
        signal,
        maxDepth: 1,
        agentOptions: { maxTokens: settings.reviewMaxTokens },
        outputSchema: REVIEW_SCHEMA,
      })
      const result = await run.result
      if (result.stopReason !== 'completed') return undefined
      return result.structured
    } catch (error) {
      ctx.logger?.warn?.(`token-watch: 审查子代理失败：${errorMessage(error)}`)
      return undefined
    } finally {
      clearTimeout(timeout)
      if (run !== undefined) await run.dispose().catch(() => {})
    }
  }

  async function askUser(agent, brief, sum, verdict, mode) {
    const userQuestions = ctx.get('userQuestions')
    const label = mode === 'progress' ? '进度审查' : '消耗审查'
    const windowMinutesText = Math.max(1, Math.round(settings.windowMs / 60_000))
    const reason = verdict?.reason
    const evidence = Array.isArray(verdict?.evidence) ? verdict.evidence : []
    const detailLines = []
    if (mode === 'progress') {
      detailLines.push(`进度审查发现模型可能钻牛角尖/原地打转，统计：`)
    } else {
      detailLines.push(`最近 ${windowMinutesText} 分钟消耗 ${sum} tokens（阈值 ${settings.thresholdTokens}），统计：`)
    }
    detailLines.push(`- 模型步骤 ${brief.stats.steps} 次，工具调用 ${brief.stats.toolCalls} 次`)
    detailLines.push(`- 生成输出 ${brief.stats.outputTokens}，新写缓存 ${brief.stats.cacheWriteTokens}，未命中缓存输入 ${brief.stats.uncachedInputTokens} tokens`)
    if (reason !== undefined) detailLines.push(`审查子代理判定：${reason}`)
    for (const item of evidence) detailLines.push(`- 证据：${item}`)
    const detail = detailLines.join('\n').slice(0, 4_000)

    if (userQuestions === undefined) {
      // No UI to collect a verdict: the pause is handed over to the user.
      // Inject the notice WITHOUT waking the driver — the model stays paused
      // until the user writes something in the conversation.
      const state = states.get(agent.session)
      if (state !== undefined) state.cancelledByGuard = false
      inject(agent, `Token Watch：${label}触发暂停${reason === undefined ? '' : `（${reason}）`}。当前环境没有用户提问界面，任务保持暂停，请用户直接在对话中指示。`)
      return
    }
    let answer
    try {
      answer = await userQuestions.ask({
        agent,
        questions: [{
          id: `token-watch-${agent.id}-${Date.now()}`,
          header: 'Token Watch 审查',
          question: mode === 'progress'
            ? `进度审查判定异常（${reason ?? '原因不明'}），如何处置？`
            : `检测到异常 token 消耗（最近 ${windowMinutesText} 分钟 ${sum} tokens），如何处置？`,
          detail,
          options: QUESTION_OPTIONS,
        }],
        signal: lifecycle.signal,
      })
    } catch (error) {
      ctx.logger?.warn?.(`token-watch: 无法向用户确认：${errorMessage(error)}`)
      resume(agent, `Token Watch：无法向用户确认处置方式（${errorMessage(error)}），任务已恢复。`)
      return
    }
    const state = states.get(agent.session)
    if (state !== undefined) state.cancelledByGuard = false
    const selected = answer.answers[0]?.selected ?? []
    if (selected.includes(OPTION_DISABLE)) {
      settings.enabled = false
      resume(agent, 'Token Watch：用户已关闭本功能。本次审查已暂停过，任务恢复继续执行。')
    } else if (selected.includes(OPTION_STOP)) {
      // "Stop" means the task is over: deliver the notice WITHOUT waking the
      // driver. The model stays idle until the user sends a new message; a
      // followup here would start another turn and let the task continue.
      inject(agent, `Token Watch：用户已根据${label}结果决定停止当前任务。当前任务到此为止，请勿继续执行；如需进展汇报，等待用户提问即可。`)
    } else {
      resume(agent, `Token Watch：用户已知悉${label}结果并选择继续。请继续当前任务，注意效率与 token 消耗。${reason === undefined ? '' : `审查结论：${reason}`}`)
    }
  }

  function resume(agent, text) {
    agent.followup(createPluginMessage(text))
  }

  function inject(agent, text) {
    agent.inject(createPluginMessage(text))
  }
}

/** Create a frozen plugin-sourced user message (mirrors createUserMessage). */
function createPluginMessage(text) {
  const message = {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-devkit-token-watch',
      form: 'notice',
      summary: boundSummary(text),
    },
  }
  Object.freeze(message)
  return message
}

function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content.map(block => {
    if (block.type === 'text' || block.type === 'reasoning') return block.text
    if (block.type === 'tool-call') return `${block.name}(…)`
    if (block.type === 'tool-result') return '[结果]'
    return ''
  }).join(' ').trim()
}

function truncate(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

function clampInt(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
