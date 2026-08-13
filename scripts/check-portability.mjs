import { spawnSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const workstationWord = ['Desk', 'top'].join('')
const rules = [
  {
    name: 'Windows drive path',
    pattern: /(?:^|[^A-Za-z0-9+.-])[A-Za-z]:[\\/]/,
  },
  {
    name: 'developer home path',
    pattern: /(?:^|[^A-Za-z0-9])[/\\](?:Users|home)[/\\][^/\\\s"'<>]+/i,
  },
  {
    name: 'workstation folder',
    pattern: new RegExp(`\\b${workstationWord}\\b`, 'i'),
  },
  {
    name: 'UNC path',
    pattern: /(?:^|[\s"'`(])\\\\[^\\\s]+\\[^\\\s]+/,
  },
]

export function findTextViolations(file, text) {
  const violations = []
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        violations.push({ file, line: index + 1, rule: rule.name, text: line.trim() })
      }
    }
  }
  return violations
}

export function scanRepository(root) {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'buffer' },
  )
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr?.toString('utf8').trim()}`)
  }
  const files = result.stdout.toString('utf8').split('\0').filter(Boolean)
  return scanFiles(root, files)
}

export function scanDirectory(root) {
  return scanFiles(root, listFiles(root))
}

function scanFiles(root, files) {
  return files.flatMap(file => {
    const absoluteFile = resolve(root, file)
    try {
      if (!lstatSync(absoluteFile).isFile()) return []
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const content = readFileSync(absoluteFile)
    if (content.includes(0)) return []
    return findTextViolations(file.replaceAll('\\', '/'), content.toString('utf8'))
  })
}

function listFiles(root, directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = resolve(directory, entry.name)
    if (entry.isDirectory()) return listFiles(root, entryPath)
    if (!entry.isFile()) return []
    return [relative(root, entryPath)]
  })
}

function formatViolation(violation) {
  return `${violation.file}:${violation.line} [${violation.rule}] ${violation.text}`
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = resolve(import.meta.dirname, '..')
  const violations = scanRepository(root)
  if (violations.length > 0) {
    process.stderr.write(`Portable-content check failed (${violations.length}):\n`)
    process.stderr.write(`${violations.map(formatViolation).join('\n')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('Portable-content check passed.\n')
  }
}
