import type { Command } from './commands.js'

export class IllegalCommandError extends Error {
  constructor(message: string, public readonly command?: Command) {
    super(message)
    this.name = 'IllegalCommandError'
  }
}
