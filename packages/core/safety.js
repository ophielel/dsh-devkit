const SECRET_PATTERN = /(?:^|[\\/])(?:\.env(?:\.[^\\/\s]+)?|id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\.json)?|\.npmrc|\.pypirc)(?:$|[\s"'])|(?:api[_-]?key|access[_-]?token|client[_-]?secret)/i
const DESTRUCTIVE_GIT_PATTERN = /\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*[fdx]|push\b[^\r\n]*(?:--force|-f\b)|checkout\s+--\s|branch\s+-D\s|rebase\b|filter-(?:branch|repo)\b)/i
const DESTRUCTIVE_SHELL_PATTERN = /(?:^|[;&|]\s*)(?:rm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)|del\s+\/s\b|rmdir\s+\/s\b)|\bRemove-Item\b[^\r\n]*(?:-Recurse|-Force)|\b(?:mkfs|format)\b/i
const DATABASE_WRITE_PATTERN = /\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|drop\s+(?:table|database|schema)|truncate\s+table|alter\s+(?:table|database|schema)|create\s+(?:table|database|schema)|grant\s+|revoke\s+)\b/i
const SAFE_GITHUB_PATTERN = /^(?:get|list|search|read|fetch|download|resolve|compare|check|actions_get|issue_read|pull_request_read|repos_get|context)_/i
const HIGH_AUTHORITY_BROWSER_PATTERN = /(?:file_upload|evaluate|run_code_unsafe|grant_permissions|storage_state|route(?:_|$))/i

export function reasonForExecution(execution) {
  const name = String(execution.name ?? '')
  const serializedArguments = stringifyArguments(execution.arguments)

  if (SECRET_PATTERN.test(serializedArguments)) {
    return '该操作可能读取凭据或其他敏感文件，需要一次性审批。'
  }
  if (DESTRUCTIVE_GIT_PATTERN.test(serializedArguments)) {
    return '该 Git 操作可能丢失历史或覆盖远端状态，需要一次性审批。'
  }
  if (DESTRUCTIVE_SHELL_PATTERN.test(serializedArguments)) {
    return '该命令包含递归、强制或其他破坏性文件操作，需要一次性审批。'
  }
  if (DATABASE_WRITE_PATTERN.test(serializedArguments)) {
    return '检测到数据库写操作；DevKit 默认按只读边界处理，需要一次性审批。'
  }
  if (name.startsWith('mcp__github__')) {
    const rawName = name.slice('mcp__github__'.length)
    if (!SAFE_GITHUB_PATTERN.test(rawName)) {
      return '该 GitHub 写操作会改变 Issue、PR、仓库或 CI 状态，需要一次性审批。'
    }
  }
  if (name.includes('browser') && HIGH_AUTHORITY_BROWSER_PATTERN.test(name)) {
    return '该浏览器高权限操作可能执行脚本、上传文件或修改网络行为，需要一次性审批。'
  }
  if (name === 'cordis_run' || name === 'cordis_stop' || name === 'cordis_undefine') {
    return '该运行时扩展操作会加载、停止或卸载当前进程中的临时能力，需要一次性审批。'
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
