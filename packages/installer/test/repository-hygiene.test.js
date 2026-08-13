import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { findTextViolations, scanRepository } from '../../../scripts/check-portability.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../../..')

test('portable path checker catches workstation-specific paths without flagging portable examples', () => {
  const workstationWord = ['Desk', 'top'].join('')
  const drivePath = ['Q', ':', '\\', 'Users', '\\', 'developer', '\\', workstationWord, '\\', 'project'].join('')
  const posixHomePath = ['/', 'home', '/', 'developer', '/', 'project'].join('')
  const uncPath = ['\\', '\\', 'server', '\\', 'share', '\\', 'project'].join('')

  assert.ok(findTextViolations('fixture.md', drivePath).length >= 1)
  assert.ok(findTextViolations('fixture.md', posixHomePath).length >= 1)
  assert.ok(findTextViolations('fixture.md', uncPath).length >= 1)
  assert.deepEqual(findTextViolations('fixture.md', 'npx dsh-devkit install --harness <path>\ncd ./deepseek-harness'), [])
  assert.deepEqual(findTextViolations('fixture.md', 'https://example.test/project'), [])
})

test('tracked repository content contains no workstation-specific paths', () => {
  assert.deepEqual(scanRepository(repositoryRoot), [])
})
