import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../../..')

function readBundle(name) {
  const directory = resolve(root, 'packages', name)
  return {
    manifest: JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')),
    patch: readFileSync(resolve(directory, 'cordis.patch.yml'), 'utf8'),
  }
}

test('every selectable component is an official Harness Bundle package', () => {
  for (const name of ['core', 'github', 'browser', 'runtime']) {
    const { manifest } = readBundle(name)
    assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
    assert.equal(manifest.version, '0.1.0')
  }
})

test('installer release version is independent from Bundle versions', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'packages', 'installer', 'package.json'), 'utf8'))
  assert.equal(manifest.version, '0.1.1')
})

test('GitHub Bundle uses official remote MCP with narrowed engineering toolsets and env-only auth', () => {
  const { patch } = readBundle('github')
  assert.match(patch, /https:\/\/api\.githubcopilot\.com\/mcp\//)
  assert.match(patch, /X-MCP-Toolsets: context,repos,issues,pull_requests,actions/)
  assert.match(patch, /process\.env\.GITHUB_PERSONAL_ACCESS_TOKEN/)
  assert.doesNotMatch(patch, /ghp_[A-Za-z0-9]/)
})

test('Browser Bundle pins text-first isolated Playwright MCP without unrestricted file access', () => {
  const { patch } = readBundle('browser')
  assert.match(patch, /@playwright\/mcp@0\.0\.79/)
  assert.match(patch, /'--headless'/)
  assert.match(patch, /'--isolated'/)
  assert.match(patch, /'--caps', 'devtools'/)
  assert.doesNotMatch(patch, /allow-unrestricted-file-access/)
})

test('Runtime Bundle exposes Harness-owned lifecycle tools without implementing another loader', () => {
  const { patch } = readBundle('runtime')
  assert.match(patch, /@deepseek-ai\/dsh-tool-cordis/)
  assert.doesNotMatch(patch, /mcp-client/)
})
