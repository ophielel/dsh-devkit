import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const skillsRoot = fileURLToPath(new URL('./skills', import.meta.url))

export function parseSkillMarkdown(markdown, filename) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown)
  if (match === null) throw new Error(`${filename}: skill frontmatter is required`)
  const fields = new Map()
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  const name = fields.get('name')
  const description = fields.get('description')
  if (name === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`${filename}: skill name must be kebab-case`)
  }
  if (description === undefined || description === '') {
    throw new Error(`${filename}: skill description is required`)
  }
  return {
    name,
    description,
    source: 'dsh-devkit-core',
    content: match[2].trim(),
  }
}

export function loadSkills() {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(skillsRoot, entry.name, 'SKILL.md'))
    .sort()
    .map(path => parseSkillMarkdown(readFileSync(path, 'utf8'), path))
}

