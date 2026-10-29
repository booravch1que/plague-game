import assert from 'node:assert/strict';
import {
  createGame,
  reduce,
  type Command,
  type GameState,
  type PlayerCommand,
  type Role,
} from '../src';

export const IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];

/** A small driver around the pure engine with its own fake real-time clock. */
export class Game {
  state: GameState;
  now = 1_000_000;

  constructor(players = 6, seed = 7) {
    this.state = createGame({ playerIds: IDS.slice(0, players), seed, now: this.now });
  }

  /** Applies a command and asserts it was legal. */
  do(command: PlayerCommand): void {
    const result = reduce(this.state, command, this.now);
    if (!result.ok) assert.fail(`${command.type} failed: ${result.error.code} ${result.error.message}`);
    this.state = result.state;
  }

  /** Applies a command expected to fail and returns the error code. */
  reject(command: PlayerCommand): string {
    const result = reduce(this.state, command, this.now);
    assert.equal(result.ok, false, `${command.type} should have failed`);
    return result.ok ? '' : result.error.code;
  }

  /** Moves real time forward in one-second ticks. */
  wait(ms: number): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now = Math.min(end, this.now + 1000);
      this.tick();
    }
  }

  tick(): void {
    const result = reduce(this.state, { type: 'tick' } as Command, this.now);
    assert.ok(result.ok);
    if (result.ok) this.state = result.state;
  }

  /** Waits until the current phase is over. */
  finishPhase(): void {
    const start = `${this.state.phase.kind}${this.state.day}`;
    for (let i = 0; i < 2000 && `${this.state.phase.kind}${this.state.day}` === start; i++) this.wait(1000);
  }

  /** Runs to the start of the given day (skips summaries by readying everyone). */
  toDay(day: number): void {
    while (this.state.day < day && this.state.phase.kind !== 'over') {
      if (this.state.phase.kind === 'summary') {
        for (const p of this.state.players.filter((x) => x.status === 'alive')) this.do({ type: 'ready', playerId: p.id });
        this.tick();
      } else {
        this.finishPhase();
      }
    }
  }

  /** The phase kind, read through a getter so tests are not narrowed by earlier asserts. */
  get phase(): string {
    return this.state.phase.kind;
  }

  byRole(role: Role) {
    const p = this.state.players.find((x) => x.role === role);
    assert.ok(p, `no ${role} in this game`);
    return p;
  }

  id(role: Role): string {
    return this.byRole(role).id;
  }

  player(id: string) {
    const p = this.state.players.find((x) => x.id === id);
    assert.ok(p);
    return p;
  }

  /** Test-only shortcut: puts a player somewhere without spending a move. */
  teleport(id: string, location: GameState['players'][number]['location']): void {
    const p = this.player(id);
    p.location = location;
    p.workStart = null;
    p.exposureStart = null;
    p.exposedThisVisit = false;
    p.shopping = false;
  }

  keys(id: string): string[] {
    return this.state.messages.filter((m) => m.to === 'all' || m.to.includes(id)).map((m) => m.key ?? m.kind);
  }
}
