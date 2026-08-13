import { installCapabilityScopes } from './capabilities.js'
import { denyReasonForExecution, reasonForExecution } from './safety.js'
import { loadSkills } from './skills.js'

export const name = 'dsh-devkit-core'
export const inject = ['agents', 'skills', 'tools']

export function apply(ctx) {
  for (const skill of loadSkills()) {
    ctx.effect(() => ctx.skills.register(skill))
  }
  installCapabilityScopes(ctx)
  ctx.on('tools/pre-execute', async (execution, next) => {
    const reason = reasonForExecution(execution)
    if (reason !== undefined) return { kind: 'ask', reason }
    return next()
  })
  ctx.effect(() => ctx.tools.guard(execution => denyReasonForExecution(execution)))
}
