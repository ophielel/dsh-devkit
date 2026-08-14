const VALUE_FLAGS = new Set(['--preset', '--modules', '--profile', '--harness'])

export function parseArgs(argv) {
  const options = {
    command: 'install',
    preset: undefined,
    modules: undefined,
    profile: 'web',
    harness: undefined,
    dryRun: false,
    yes: false,
    noVerify: false,
  }
  let index = 0
  if (argv[0] !== undefined && !argv[0].startsWith('-')) {
    options.command = argv[0]
    index = 1
  }
  for (; index < argv.length; index += 1) {
    const flag = argv[index]
    if (VALUE_FLAGS.has(flag)) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${flag} 需要一个值`)
      index += 1
      if (flag === '--preset') options.preset = value
      if (flag === '--modules') options.modules = value
      if (flag === '--profile') options.profile = value
      if (flag === '--harness') options.harness = value
      continue
    }
    if (flag === '--dry-run') options.dryRun = true
    else if (flag === '--yes') options.yes = true
    else if (flag === '--no-verify') options.noVerify = true
    else if (flag === '--help' || flag === '-h') options.command = 'help'
    else throw new Error(`未知参数：${flag}`)
  }
  if (!['install', 'uninstall', 'launch', 'doctor', 'help'].includes(options.command)) {
    throw new Error(`未知命令：${options.command}`)
  }
  if (options.preset !== undefined && options.modules !== undefined) {
    throw new Error('不能同时使用 --preset 和 --modules')
  }
  if (options.command === 'launch') {
    if (options.preset !== undefined) throw new Error('launch 不支持 --preset')
    if (options.modules !== undefined) throw new Error('launch 不支持 --modules')
    if (options.yes) throw new Error('launch 不支持 --yes')
    if (options.noVerify) throw new Error('launch 不支持 --no-verify')
  }
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(options.profile)) {
    throw new Error('profile 只能包含字母、数字、下划线和连字符')
  }
  return options
}
