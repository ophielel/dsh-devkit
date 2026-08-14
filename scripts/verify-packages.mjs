import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { scanDirectory } from './check-portability.mjs'

const root = resolve(import.meta.dirname, '..')
const packageDirectories = ['installer', 'core', 'github', 'browser', 'runtime']
const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-devkit-pack-'))
const packDirectory = join(temporaryRoot, 'packs')
const consumerDirectory = join(temporaryRoot, 'consumer')
mkdirSync(packDirectory)
mkdirSync(consumerDirectory)

try {
  const tarballs = packageDirectories.map(directory => packPackage(directory))
  writeFileSync(join(consumerDirectory, 'package.json'), JSON.stringify({ private: true }, null, 2))
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], consumerDirectory)

  for (const directory of packageDirectories) verifyInstalledPackage(directory)
  verifyInstallerCli()
  process.stdout.write(`Verified ${tarballs.length} packed packages through a clean npm install.\n`)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}

function packPackage(directory) {
  const packageDirectory = join(root, 'packages', directory)
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))
  run('pnpm', ['pack', '--pack-destination', packDirectory], packageDirectory)
  const tarballName = `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`
  const tarball = join(packDirectory, tarballName)
  if (!existsSync(tarball)) throw new Error(`pnpm pack did not create ${tarballName}`)
  return tarball
}

function verifyInstalledPackage(directory) {
  const sourceManifest = JSON.parse(readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'))
  const installedRoot = join(consumerDirectory, 'node_modules', ...sourceManifest.name.split('/'))
  const installedManifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
  if (installedManifest.version !== sourceManifest.version) {
    throw new Error(`${sourceManifest.name} installed version mismatch`)
  }
  if (directory === 'installer' && !existsSync(join(installedRoot, 'lib', 'cli.js'))) {
    throw new Error('packed installer is missing lib/cli.js')
  }
  if (directory === 'core') {
    for (const required of ['index.js', 'capabilities.js', 'safety.js', join('skills', 'setup-github', 'SKILL.md')]) {
      if (!existsSync(join(installedRoot, required))) throw new Error(`packed core is missing ${required}`)
    }
  }
  if (!['installer', 'core'].includes(directory) && !existsSync(join(installedRoot, 'cordis.patch.yml'))) {
    throw new Error(`packed ${sourceManifest.name} is missing cordis.patch.yml`)
  }
  if (existsSync(join(installedRoot, 'test'))) throw new Error(`${sourceManifest.name} unexpectedly published test files`)
  const portabilityViolations = scanDirectory(installedRoot)
  if (portabilityViolations.length > 0) {
    const locations = portabilityViolations.map(violation => `${violation.file}:${violation.line}`).join(', ')
    throw new Error(`${sourceManifest.name} contains workstation-specific paths: ${locations}`)
  }
}

function verifyInstallerCli() {
  const installerRoot = join(consumerDirectory, 'node_modules', 'dsh-devkit')
  const installerManifest = JSON.parse(readFileSync(join(installerRoot, 'package.json'), 'utf8'))
  const cli = join(installerRoot, 'lib', 'cli.js')
  const help = run(process.execPath, [cli, '--help'], consumerDirectory)
  if (!help.includes(`dsh-devkit ${installerManifest.version}`)) throw new Error('packed CLI help did not start')

  const dryRun = run(process.execPath, [cli, 'install', '--preset', 'full', '--dry-run'], consumerDirectory)
  for (const directory of ['core', 'github', 'browser', 'runtime']) {
    const manifest = JSON.parse(readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'))
    if (!dryRun.includes(`${manifest.name}@${manifest.version}`)) {
      throw new Error(`packed CLI did not resolve ${manifest.name}@${manifest.version}`)
    }
  }
}

function run(command, args, cwd) {
  const executable = process.platform === 'win32' && command !== process.execPath
    ? process.env.ComSpec ?? 'cmd.exe'
    : command
  const commandArgs = process.platform === 'win32' && command !== process.execPath
    ? ['/d', '/s', '/c', [command, ...args].map(quoteCmdArgument).join(' ')]
    : args
  const result = spawnSync(executable, commandArgs, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${basename(command)} failed (${result.status ?? 'no status'})\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function quoteCmdArgument(value) {
  const text = String(value)
  if (/^[A-Za-z0-9_@./:\\=-]+$/.test(text)) return text
  return `"${text.replaceAll('%', '%%').replaceAll('"', '""')}"`
}
