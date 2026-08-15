export const MODULES = Object.freeze([
  Object.freeze({
    id: 'core',
    packageName: 'dsh-devkit-core',
    version: '0.1.0',
    title: 'Core safety + skills',
    description: '危险操作审批守卫，以及开发、调试和评审工作流',
  }),
  Object.freeze({
    id: 'github',
    packageName: 'dsh-devkit-github',
    version: '0.1.0',
    title: 'GitHub',
    description: 'Issue、Pull Request 与 Actions（需要 GitHub PAT）',
  }),
  Object.freeze({
    id: 'browser',
    packageName: 'dsh-devkit-browser',
    version: '0.1.0',
    title: 'Playwright Browser',
    description: 'DOM、可访问性快照、Console 与 Network 验证',
  }),
  Object.freeze({
    id: 'runtime',
    packageName: 'dsh-devkit-runtime',
    version: '0.1.0',
    title: 'Runtime extensions',
    description: '检查并临时加载、停止或卸载 Cordis 能力',
  }),
  Object.freeze({
    id: 'token-watch',
    packageName: 'dsh-devkit-token-watch',
    version: '0.1.0',
    title: 'Token Watch',
    description: '消耗超限/长时间工作时后台并行审查，异常时暂停并请用户裁决',
  }),
])

const PRESETS = Object.freeze({
  frontend: Object.freeze(['core', 'github', 'browser', 'runtime']),
  backend: Object.freeze(['core', 'github', 'runtime']),
  full: Object.freeze(MODULES.map(module => module.id)),
})

export function modulesForPreset(preset) {
  const modules = PRESETS[preset]
  if (modules === undefined) {
    throw new Error(`未知 preset "${preset}"；可用值：${Object.keys(PRESETS).join(', ')}`)
  }
  return [...modules]
}

export function normalizeModuleNames(value) {
  const requested = new Set(
    (Array.isArray(value) ? value : String(value).split(','))
      .map(name => name.trim())
      .filter(Boolean),
  )
  const known = new Set(MODULES.map(module => module.id))
  const unknown = [...requested].filter(name => !known.has(name))
  if (unknown.length > 0) {
    throw new Error(`未知模块：${unknown.join(', ')}；可用值：${[...known].join(', ')}`)
  }
  return MODULES.map(module => module.id).filter(id => requested.has(id))
}

export function createPickerState(selected = MODULES.map(module => module.id)) {
  return Object.freeze({
    cursor: 0,
    selected: new Set(normalizeModuleNames(selected)),
    status: 'editing',
    message: '',
  })
}

export function applyPickerEvent(state, event) {
  if (state.status !== 'editing') return state
  if (event.type === 'move') {
    const cursor = (state.cursor + event.delta + MODULES.length) % MODULES.length
    return Object.freeze({ ...state, cursor, message: '' })
  }
  if (event.type === 'toggle') {
    const selected = new Set(state.selected)
    const id = MODULES[state.cursor].id
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    return Object.freeze({ ...state, selected, message: '' })
  }
  if (event.type === 'submit') {
    if (state.selected.size === 0) {
      return Object.freeze({ ...state, message: '至少选择一个模块。' })
    }
    return Object.freeze({ ...state, status: 'submitted', message: '' })
  }
  if (event.type === 'cancel') {
    return Object.freeze({ ...state, status: 'cancelled', message: '' })
  }
  return state
}
