import assert from 'node:assert/strict'
import test from 'node:test'
import { loadSkills, parseSkillMarkdown } from '../skills.js'

test('skill parser extracts required metadata and excludes frontmatter from model content', () => {
  const skill = parseSkillMarkdown('---\nname: demo-skill\ndescription: Demo workflow\n---\n\n# Steps\n\nDo the work.\n', 'demo.md')
  assert.deepEqual(skill, {
    name: 'demo-skill',
    description: 'Demo workflow',
    source: 'dsh-devkit-core',
    content: '# Steps\n\nDo the work.',
  })
})

test('skill parser fails loud on malformed or non-kebab-case metadata', () => {
  assert.throws(() => parseSkillMarkdown('# no frontmatter', 'bad.md'), /frontmatter/)
  assert.throws(
    () => parseSkillMarkdown('---\nname: Bad_Name\ndescription: Bad\n---\nbody', 'bad.md'),
    /kebab-case/,
  )
})

test('core bundle ships the focused MVP skill catalog', () => {
  const skills = loadSkills()
  const names = skills.map(skill => skill.name)
  assert.deepEqual(names, [
    'debug-frontend',
    'debug-production',
    'fix-ci',
    'fix-github-issue',
    'review-pr',
    'safe-refactor',
    'setup-browser',
    'setup-github',
    'troubleshoot-devkit',
  ])
  assert.equal(new Set(names).size, names.length)
  assert.ok(skills.every(skill => skill.content.length > 120))
})
