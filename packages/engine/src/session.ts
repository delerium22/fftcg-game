import type { GameState } from './state.js'
import type { Command } from './commands.js'
import type { Event } from './events.js'
import { createGame, type CreateGameOptions } from './setup.js'
import { apply } from './apply.js'

export class GameSession {
  private _commands: Command[] = []
  private _state: GameState
  constructor(readonly opts: CreateGameOptions) { this._state = createGame(opts) }
  get commands(): readonly Command[] { return this._commands }
  get state(): GameState { return this._state }

  apply(command: Command): Event[] {
    const r = apply(this._state, command)
    this._state = r.state
    this._commands.push(command)
    return r.events
  }

  undo(): boolean {
    if (!this._commands.length) return false
    this._commands.pop()
    this._state = GameSession.replay(this.opts, this._commands)
    return true
  }

  static replay(opts: CreateGameOptions, commands: readonly Command[]): GameState {
    return commands.reduce((s, c) => apply(s, c).state, createGame(opts))
  }

  toJSON(): { opts: CreateGameOptions; commands: Command[] } { return { opts: this.opts, commands: [...this._commands] } }
  static fromJSON(saved: { opts: CreateGameOptions; commands: Command[] }): GameSession {
    const s = new GameSession(saved.opts)
    for (const c of saved.commands) s.apply(c)
    return s
  }
}
