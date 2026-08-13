#!/usr/bin/env node

import { runApp } from './app.js'
import { parseArgs } from './options.js'

try {
  const options = parseArgs(process.argv.slice(2))
  process.exitCode = await runApp(options)
} catch (error) {
  process.stderr.write(`dsh-devkit: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
