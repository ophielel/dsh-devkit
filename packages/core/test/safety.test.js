import assert from 'node:assert/strict'
import test from 'node:test'
import { reasonForExecution } from '../safety.js'

test('asks before destructive shell and git operations', () => {
  assert.match(reasonForExecution({ name: 'pwsh', arguments: { command: 'Remove-Item -Recurse C:\\work\\build' } }), /破坏性/)
  assert.match(reasonForExecution({ name: 'bash', arguments: { command: 'git push origin main --force' } }), /Git/)
  assert.match(reasonForExecution({ name: 'bash', arguments: { command: 'git reset --hard HEAD~1' } }), /Git/)
})

test('allows ordinary read-only shell and Git commands without adding an approval prompt', () => {
  assert.equal(reasonForExecution({ name: 'bash', arguments: { command: 'git diff --stat' } }), undefined)
  assert.equal(reasonForExecution({ name: 'pwsh', arguments: { command: 'Get-ChildItem src' } }), undefined)
})

test('asks before likely secret access', () => {
  assert.match(reasonForExecution({ name: 'bash', arguments: { command: 'cat ~/.ssh/id_rsa' } }), /敏感/)
  assert.match(reasonForExecution({ name: 'read_file', arguments: { path: '/repo/.env' } }), /敏感/)
})

test('allows GitHub reads and asks before GitHub writes', () => {
  assert.equal(reasonForExecution({ name: 'mcp__github__get_file_contents', arguments: {} }), undefined)
  assert.equal(reasonForExecution({ name: 'mcp__github__list_issues', arguments: {} }), undefined)
  assert.match(reasonForExecution({ name: 'mcp__github__create_pull_request', arguments: {} }), /GitHub 写操作/)
  assert.match(reasonForExecution({ name: 'mcp__github__merge_pull_request', arguments: {} }), /GitHub 写操作/)
})

test('asks before database writes and high-authority browser calls', () => {
  assert.match(reasonForExecution({ name: 'mcp__postgres__query', arguments: { sql: 'UPDATE users SET admin=true' } }), /数据库写操作/)
  assert.match(reasonForExecution({ name: 'mcp__browser__browser_file_upload', arguments: {} }), /浏览器高权限/)
  assert.equal(reasonForExecution({ name: 'mcp__browser__browser_snapshot', arguments: {} }), undefined)
})

test('asks before runtime extension lifecycle effects but permits inspection and definition', () => {
  assert.match(reasonForExecution({ name: 'cordis_run', arguments: { id: 'dyn-1' } }), /运行时扩展/)
  assert.match(reasonForExecution({ name: 'cordis_stop', arguments: { id: 'dyn-1' } }), /运行时扩展/)
  assert.equal(reasonForExecution({ name: 'cordis_inspect', arguments: {} }), undefined)
  assert.equal(reasonForExecution({ name: 'cordis_define', arguments: {} }), undefined)
})
