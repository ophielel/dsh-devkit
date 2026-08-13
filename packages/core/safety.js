const SECRET_TARGET_PATTERN = /(?:^|[\\/])(?:\.env(?:\.[^\\/\s"']+)?|\.netrc|\.npmrc|\.pypirc|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.json)?|service[_-]?account(?:\.json)?|hosts\.yml|kube[\\/]config|\.docker[\\/]config\.json)(?:$|[\s"'])|(?:\.aws[\\/]credentials|\.config[\\/]gh[\\/]hosts\.yml|\.kube[\\/]config|\/proc\/\d+\/environ)|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\b/i
const CREDENTIAL_VALUE_PATTERN = /(?:github_pat_[A-Za-z0-9_]{20,}|gh[opusr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2})/i
const DESTRUCTIVE_GIT_PATTERN = /\bgit(?:\.exe)?\s+(?:reset\s+--hard\b|clean\s+(?=[^\r\n]*(?:-[A-Za-z]*f|--force))(?=[^\r\n]*(?:-[A-Za-z]*[dx]|--(?:directories|ignored)))|push\b[^\r\n]*(?:--force(?:-with-lease)?\b|-f\b|--mirror\b|--delete\b|\s:[^\s]+|\s\+[^\s]+)|checkout\s+--\s|restore\b|branch\s+-D\b|rebase\b|filter-(?:branch|repo)\b)/i
const DESTRUCTIVE_SHELL_PATTERN = /\brm\s+(?=[^\r\n]*(?:-[A-Za-z]*r|--recursive)\b)(?=[^\r\n]*(?:-[A-Za-z]*f|--force)\b)|\bdel\s+[^\r\n]*\/s\b|\b(?:rmdir|rd)\s+[^\r\n]*\/s\b|\bRemove-Item\b[^\r\n]*(?:-Recurse|-Force)|\b(?:Clear-Content|truncate\s+-s\s+0)\b|\bfind\b[^\r\n]*\s-delete\b|\b(?:mkfs(?:\.\w+)?|format|diskpart|shred)\b|\bdd\b[^\r\n]*\bof=\/dev\//i
const OBFUSCATED_COMMAND_PATTERN = /(?:-(?:e|en|enc|enco|encod|encodedcommand)\b|\b(?:Invoke-Expression|iex|FromBase64String)\b|\bbase64\b[^\r\n]*(?:-d|--decode)|\beval\s+["'$]|\b(?:curl|wget)\b[^\r\n|]*\|\s*(?:ba|z|k)?sh\b)/i
const PRIVILEGE_PATTERN = /(?:^|[;&|]\s*)(?:sudo\b|su\s+-?\b|runas\b)|\bStart-Process\b[^\r\n]*-Verb\s+RunAs\b|\b(?:chmod\s+(?:777|[ugo]*\+[rwx]*[wx])|chown\s|takeown\b|icacls\b[^\r\n]*\/(?:grant|setowner)|setfacl\b)/i
const ENVIRONMENT_DUMP_PATTERN = /(?:\b(?:env|printenv|set)\s*$|Get-ChildItem\s+(?:Env:|environment)|Get-Item\s+Env:|\/proc\/\d+\/environ)/im
const DATABASE_WRITE_PATTERN = /\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|drop\s+(?:table|database|schema)|truncate\s+(?:table\s+)?|alter\s+(?:table|database|schema)|create\s+(?:table|database|schema)|grant\s+|revoke\s+|replace\s+into|merge\s+into|copy\s+\S+\s+from)\b/i
const SAFE_GITHUB_PREFIX_PATTERN = /^(?:get|list|search|read|fetch|download|resolve|compare|check|actions_get|issue_read|pull_request_read|repos_get|context)(?:_|$)/i
const GITHUB_MUTATION_PATTERN = /(?:^|_)(?:create|update|delete|merge|close|reopen|add|remove|set|cancel|rerun|run|dispatch|approve|submit|lock|unlock|fork|push|upload|assign|unassign|mark|convert|restore|enable|disable)(?:_|$)/i
const HIGH_AUTHORITY_BROWSER_PATTERN = /(?:file_upload|evaluate|run_code|grant_permissions|storage_state|route(?:_|$)|install|pdf|drag|handle_dialog)/i
const RUNTIME_MUTATION_PATTERN = /^(?:cordis_define|cordis_run|cordis_stop|cordis_undefine)$/
const RUNTIME_INSPECTION_PATTERN = /^cordis_inspect_(?:list|query|self)$/

export function denyReasonForExecution(execution) {
  const serializedArguments = stringifyArguments(execution.arguments)
  if (CREDENTIAL_VALUE_PATTERN.test(serializedArguments)) {
    return '调用参数包含疑似真实凭据值，已拒绝执行；请通过 Harness 凭据存储或环境引用传递，不要把 secret 放入模型工具参数。'
  }
  return undefined
}

export function reasonForExecution(execution) {
  const name = String(execution.name ?? '')
  const serializedArguments = stringifyArguments(execution.arguments)

  if (SECRET_TARGET_PATTERN.test(serializedArguments) || ENVIRONMENT_DUMP_PATTERN.test(serializedArguments)) {
    return '该操作可能读取凭据、环境变量或其他敏感文件，需要 Harness 一次性审批。'
  }
  if (DESTRUCTIVE_GIT_PATTERN.test(serializedArguments)) {
    return '该 Git 操作可能丢失工作区、历史或覆盖远端状态，需要 Harness 一次性审批。'
  }
  if (DESTRUCTIVE_SHELL_PATTERN.test(serializedArguments)) {
    return '该命令包含递归、强制或其他破坏性文件/设备操作，需要 Harness 一次性审批。'
  }
  if (OBFUSCATED_COMMAND_PATTERN.test(serializedArguments)) {
    return '该命令包含编码、动态求值或其他混淆执行方式，需要 Harness 一次性审批。'
  }
  if (PRIVILEGE_PATTERN.test(serializedArguments)) {
    return '该操作可能提升权限或扩大文件访问权限，需要 Harness 一次性审批。'
  }
  if (DATABASE_WRITE_PATTERN.test(serializedArguments)) {
    return '检测到数据库写操作；DevKit 默认按只读边界处理，需要 Harness 一次性审批。'
  }
  if (name.startsWith('mcp__github__')) {
    const rawName = name.slice('mcp__github__'.length)
    if (!SAFE_GITHUB_PREFIX_PATTERN.test(rawName) || GITHUB_MUTATION_PATTERN.test(rawName)) {
      return '该 GitHub 写操作可能改变 Issue、PR、仓库或 CI 状态，需要 Harness 一次性审批。'
    }
  }
  if (name.includes('browser') && HIGH_AUTHORITY_BROWSER_PATTERN.test(name)) {
    return '该浏览器高权限操作可能执行页面脚本、上传文件、改变权限或修改网络行为，需要 Harness 一次性审批。'
  }
  if (RUNTIME_MUTATION_PATTERN.test(name)) {
    return '该运行时扩展操作会定义、加载、停止或删除当前进程中的能力，可能影响其他会话，需要 Harness 一次性审批。'
  }
  if (name.startsWith('cordis_') && !RUNTIME_INSPECTION_PATTERN.test(name)) {
    return '未知的 Cordis 运行时操作按高权限能力处理，需要 Harness 一次性审批。'
  }
  if (name === 'devkit_capability' && execution.arguments?.module === 'runtime' && execution.arguments?.enabled === true) {
    return '启用 Runtime 运行时扩展工具会让模型在当前任务中看到自修改能力，需要 Harness 一次性审批。'
  }
  return undefined
}

function stringifyArguments(value) {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return String(value)
  }
}
