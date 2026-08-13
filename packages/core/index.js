import { reasonForExecution } from './safety.js'
import { loadSkills } from './skills.js'

export const name = 'dsh-devkit-core'
export const inject = ['skills', 'tools']

export function apply(ctx) {
  for (const skill of loadSkills()) {
    ctx.effect(() => ctx.skills.register(skill))
  }
  ctx.on('tools/pre-execute', async (execution, next) => {
    const reason = reasonForExecution(execution)
    if (reason !== undefined) return { kind: 'ask', reason }
    return next()
  })
}

