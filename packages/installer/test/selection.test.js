import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MODULES,
  applyPickerEvent,
  createPickerState,
  modulesForPreset,
  normalizeModuleNames,
} from '../lib/selection.js'

test('full preset selects every independently installable module', () => {
  assert.deepEqual(modulesForPreset('full'), MODULES.map(module => module.id))
})

test('frontend and backend presets keep browser exposure task-specific', () => {
  assert.deepEqual(modulesForPreset('frontend'), ['core', 'github', 'browser', 'runtime'])
  assert.deepEqual(modulesForPreset('backend'), ['core', 'github', 'runtime'])
})

test('picker moves with wraparound and toggles only the focused module', () => {
  let state = createPickerState(['core'])
  state = applyPickerEvent(state, { type: 'move', delta: -1 })
  assert.equal(state.cursor, MODULES.length - 1)
  state = applyPickerEvent(state, { type: 'toggle' })
  assert.deepEqual([...state.selected].sort(), ['core', 'runtime'])
})

test('picker submit refuses an empty selection and accepts a non-empty selection', () => {
  let state = createPickerState([])
  state = applyPickerEvent(state, { type: 'submit' })
  assert.equal(state.status, 'editing')
  assert.match(state.message, /至少选择一个/)

  state = applyPickerEvent(state, { type: 'toggle' })
  state = applyPickerEvent(state, { type: 'submit' })
  assert.equal(state.status, 'submitted')
})

test('module parser trims, deduplicates, preserves catalog order, and rejects unknown names', () => {
  assert.deepEqual(normalizeModuleNames('runtime, core,core'), ['core', 'runtime'])
  assert.throws(() => normalizeModuleNames('core,magic'), /未知模块.*magic/)
})
