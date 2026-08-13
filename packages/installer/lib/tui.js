import { applyPickerEvent, createPickerState, MODULES } from './selection.js'

export function decodeKey(key) {
  if (key === '\u001b[A' || key === 'k') return { type: 'move', delta: -1 }
  if (key === '\u001b[B' || key === 'j') return { type: 'move', delta: 1 }
  if (key === ' ') return { type: 'toggle' }
  if (key === '\r' || key === '\n') return { type: 'submit' }
  if (key === 'q' || key === '\u0003' || key === '\u001b') return { type: 'cancel' }
  return undefined
}

export function renderPicker(state, { profile, width = 80 }) {
  const safeWidth = Math.max(1, width)
  const lines = [
    'dsh-devkit installer',
    `Profile: ${profile}`,
    '',
    ...MODULES.flatMap((module, index) => {
      const focused = index === state.cursor ? '›' : ' '
      const checked = state.selected.has(module.id) ? 'x' : ' '
      return [
        `${focused} [${checked}] ${module.title}`,
        `      ${module.description}`,
      ]
    }),
    ...(state.message === '' ? [] : ['', `! ${state.message}`]),
    '',
    '↑↓ 移动  Space 选择  Enter 安装  q 退出',
  ]
  return lines.map(line => truncate(line, safeWidth)).join('\n')
}

export function runPicker({ profile, input = process.stdin, output = process.stdout, selected } = {}) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('当前不是交互式终端；请使用 --preset 或 --modules')
  }
  let state = createPickerState(selected)
  const render = () => {
    output.write(`\u001b[2J\u001b[H${renderPicker(state, { profile, width: output.columns ?? 80 })}`)
  }
  return new Promise((resolveResult, reject) => {
    const previousRaw = input.isRaw
    input.setRawMode(true)
    input.setEncoding('utf8')
    input.resume()
    const cleanup = () => {
      input.off('data', onData)
      input.setRawMode(previousRaw ?? false)
      input.pause()
      output.write('\u001b[?25h\n')
    }
    const onData = (key) => {
      try {
        const event = decodeKey(key)
        if (event === undefined) return
        state = applyPickerEvent(state, event)
        render()
        if (state.status === 'submitted') {
          cleanup()
          resolveResult(MODULES.map(module => module.id).filter(id => state.selected.has(id)))
        } else if (state.status === 'cancelled') {
          cleanup()
          resolveResult(undefined)
        }
      } catch (error) {
        cleanup()
        reject(error)
      }
    }
    output.write('\u001b[?25l')
    input.on('data', onData)
    render()
  })
}

function truncate(value, width) {
  if (displayWidth(value) <= width) return value
  if (width === 1) return '…'
  let result = ''
  let used = 0
  for (const character of value) {
    const characterWidth = codePointWidth(character.codePointAt(0))
    if (used + characterWidth > width - 1) break
    result += character
    used += characterWidth
  }
  return `${result}…`
}

export function displayWidth(value) {
  let width = 0
  for (const character of value) width += codePointWidth(character.codePointAt(0))
  return width
}

function codePointWidth(codePoint) {
  if (codePoint === 0 || codePoint === undefined) return 0
  if ((codePoint >= 0x300 && codePoint <= 0x36f)
    || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)) return 0
  if (codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329 || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )) return 2
  return 1
}
