import { useEffect, useState, type JSX } from 'react'
import type { CardId, FieldCard, PlayerId, PlayerView } from '@fftcg/engine'
import { fieldCardDisplay } from '../game/commands.js'
import type { Choice, ChoiceSet, GameApi } from '../game/types.js'
import { AI, HUMAN } from '../game/types.js'
import { Card } from './Card.js'
import { EventLog } from './EventLog.js'
import { PromptStrip } from './PromptStrip.js'

const MAX_DAMAGE = 7   // §12.2.2: a player with 7 damage loses

function defOf(v: PlayerView, id: CardId) {
  const inst = v.cards[id]
  return inst ? v.defs[inst.code] : undefined
}

/** One card on a field, wired to whatever choices target it. */
function FieldCardView({ v, c, choices, selected, onPick, size }: {
  v: PlayerView; c: FieldCard; choices: Choice[]; selected: boolean; onPick: (id: CardId) => void; size: 'field' | 'small'
}): JSX.Element {
  const d = defOf(v, c.id)
  // Spec C1-7: `effectivePower` (via `fieldCardDisplay`) is the ONE power authority, and the board is a
  // consumer of it. Passing printed `def.power` here would show a pumped Forward the wrong power AND the wrong
  // damage ratio, because `Card` derives remaining power and the damage bar from whatever number it is given.
  const shown = fieldCardDisplay(v, c)
  return (
    <Card
      code={d?.code ?? '?'}
      name={d?.name ?? 'Unknown'}
      cost={d?.cost ?? 0}
      elements={d?.elements ?? []}
      type={d?.type ?? 'forward'}
      power={shown.power}
      powerBonus={shown.powerBonus}
      granted={shown.granted}
      flags={shown.flags}
      damage={c.damage}
      dull={c.status === 'dull'}
      selectable={choices.length > 0}
      selected={selected}
      size={size}
      onClick={choices.length ? () => onPick(c.id) : undefined}
    />
  )
}

function Zone({ label, children, empty, compact }: { label: string; children: JSX.Element[]; empty: boolean; compact?: boolean }): JSX.Element {
  const cls = ['zone__cards', empty ? 'zone__cards--empty' : '', compact ? 'zone__cards--compact' : ''].filter(Boolean).join(' ')
  return (
    <div className="zone">
      <div className="zone__label">{label}</div>
      <div className={cls}>{children}</div>
    </div>
  )
}

function Seat({ v, p, active }: { v: PlayerView; p: PlayerId; active: boolean }): JSX.Element {
  const f = v.fields[p]
  const you = p === HUMAN
  const damage = f.damageZone.length
  return (
    <div className={active ? 'seat seat--active' : 'seat'}>
      <span className={you ? 'seat__name seat__name--you' : 'seat__name'}>{you ? 'You' : 'AI'}</span>
      <div className="seat__stats">
        <span className="stat"><span className="stat__label">Deck</span><span className="stat__value">{f.deck.length}</span></span>
        <span className="stat"><span className="stat__label">Hand</span><span className="stat__value">{you ? v.hand.length : f.handCount}</span></span>
        <span className="stat"><span className="stat__label">Break</span><span className="stat__value">{f.breakZone.length}</span></span>
        <span className="stat">
          <span className="stat__label">Damage</span>
          <span className="damage-track" role="img" aria-label={`${damage} of ${MAX_DAMAGE} damage`}>
            {Array.from({ length: MAX_DAMAGE }, (_, i) => (
              <span key={i} className={i < damage ? 'damage-pip is-filled' : 'damage-pip'} />
            ))}
          </span>
        </span>
      </div>
    </div>
  )
}

/** The card ids the board draws in its named zones: both fields, and your hand. */
export function boardCardIds(view: PlayerView): Set<CardId> {
  return new Set<CardId>([
    ...view.hand,
    ...([0, 1] as const).flatMap((p) => [...view.fields[p].forwards, ...view.fields[p].backups].map((c) => c.id)),
  ])
}

/** Targetable cards those zones do NOT draw — the Break Zone today, more hidden zones in C2/C3. */
export function orphanTargetIds(view: PlayerView, choices: ChoiceSet): CardId[] {
  const drawn = boardCardIds(view)
  return [...choices.byCard.keys()].filter((id) => !drawn.has(id))
}

/**
 * Every choice the board actually lets you click: the strip's loose buttons, plus the choices under any card it
 * draws — named zones and the orphan row alike. Tests drive from THIS rather than from `choices.all`, because
 * `choices.all` includes choices keyed to cards no component renders, which is exactly how Billy Bob's
 * Break-Zone target shipped unanswerable while the sweep passed.
 */
export function clickableChoices(view: PlayerView, choices: ChoiceSet): Choice[] {
  const reachable = new Set<CardId>([...boardCardIds(view), ...orphanTargetIds(view, choices)])
  // Filter `all` rather than rebuilding from loose + byCard: that would put every strip button ahead of every
  // card choice, and a caller taking "the first choice" would then only ever pass.
  return choices.all.filter((c) => c.card === null || reachable.has(c.card))
}

export function Board({ game }: { game: GameApi }): JSX.Element {
  const { view, choices, log, aiThinking, choose, restart } = game
  const [selected, setSelected] = useState<CardId | null>(null)

  // The choice set is rebuilt on every state change; a card selected under the old one may no longer be
  // clickable (or may not exist), so drop the selection rather than leave a highlight pointing at nothing.
  useEffect(() => { setSelected((id) => (id !== null && choices.byCard.has(id) ? id : null)) }, [choices])

  const pick = (id: CardId): void => {
    const forCard = choices.byCard.get(id) ?? []
    // One way to use a card: just do it. Several (a cast with options, a party to attack with): select it and
    // let the prompt strip show what they are, so a click is never a guess about which variant you got.
    if (forCard.length === 1) { setSelected(null); choose(forCard[0] as Choice); return }
    setSelected((cur) => (cur === id ? null : id))
  }

  // Concede is legal in every state (§2.1), so `legalCommands` puts it first — which would make it the leftmost,
  // most-reachable button on the strip all game. Sort it to the end; nothing else changes order.
  const order = (c: Choice) => (c.command.type === 'concede' ? 1 : 0)
  const shown = (selected === null ? choices.loose : [...(choices.byCard.get(selected) ?? []), ...choices.loose])
    .slice().sort((a, b) => order(a) - order(b))
  // Backups render small: they are CP sources rather than combat units, and with auto-pay (spec B6) they are
  // rarely a click target — which also buys the vertical room two full-size field rows per side would not fit in.
  const field = (p: PlayerId, kind: 'forwards' | 'backups'): JSX.Element[] =>
    view.fields[p][kind].map((c) => (
      <FieldCardView key={c.id} v={view} c={c} choices={choices.byCard.get(c.id) ?? []} selected={selected === c.id} onPick={pick} size={kind === 'backups' ? 'small' : 'field'} />
    ))

  // Every clickable choice must be reachable, or the game dead-ends: Billy Bob's ETB targets your BREAK ZONE,
  // which the board otherwise shows only as a count, so its answer lived entirely in `byCard` under an id no
  // Card rendered — leaving Concede as the only button while the strip said "click a highlighted card".
  // Rather than special-case the Break Zone, gather ANY targetable card the board does not already draw and
  // give it a row. That closes the class (C2/C3 target more hidden zones) instead of this one instance.
  const orphanTargets = orphanTargetIds(view, choices)
  const orphanCards = orphanTargets.map((id) => {
    const d = defOf(view, id)
    return (
      <Card
        key={id}
        code={d?.code ?? '?'}
        name={d?.name ?? 'Unknown'}
        cost={d?.cost ?? 0}
        elements={d?.elements ?? []}
        type={d?.type ?? 'forward'}
        power={d?.power ?? null}
        selectable
        selected={selected === id}
        size="small"
        onClick={() => pick(id)}
      />
    )
  })

  return (
    <div className="table">
      <section className="table__seat table__seat--opponent">
        <Seat v={view} p={AI} active={view.priority === AI || view.pending?.player === AI} />
        <Zone label="AI Backups" compact empty={!view.fields[AI].backups.length}>{field(AI, 'backups')}</Zone>
        <Zone label="AI Forwards" empty={!view.fields[AI].forwards.length}>{field(AI, 'forwards')}</Zone>
      </section>

      <PromptStrip view={view} choices={choices} shown={shown} aiThinking={aiThinking} onChoose={(c) => { setSelected(null); choose(c) }} />

      {/* `.table__seat--player` is column-reverse, so this list reads bottom-up on screen: the status bar sits
          at the outer edge and forwards end up nearest the prompt strip, meeting the AI's across it. */}
      <section className="table__seat table__seat--player">
        <Seat v={view} p={HUMAN} active={view.priority === HUMAN || view.pending?.player === HUMAN} />
        <Zone label="Your Backups" compact empty={!view.fields[HUMAN].backups.length}>{field(HUMAN, 'backups')}</Zone>
        <Zone label="Your Forwards" empty={!view.fields[HUMAN].forwards.length}>{field(HUMAN, 'forwards')}</Zone>
      </section>

      <section className="table__hand">
        {orphanCards.length > 0 && <Zone label="Choose a card" compact empty={false}>{orphanCards}</Zone>}
        <div className="hand">
          {view.hand.map((id) => {
            const d = defOf(view, id)
            const forCard = choices.byCard.get(id) ?? []
            return (
              <Card
                key={id}
                code={d?.code ?? '?'}
                name={d?.name ?? 'Unknown'}
                cost={d?.cost ?? 0}
                elements={d?.elements ?? []}
                type={d?.type ?? 'forward'}
                power={d?.power ?? null}
                selectable={forCard.length > 0}
                selected={selected === id}
                size="hand"
                onClick={forCard.length ? () => pick(id) : undefined}
              />
            )
          })}
        </div>
      </section>

      <aside className="table__rail"><EventLog log={log} /></aside>

      {view.result && (
        <div className="banner" role="alertdialog" aria-label="Game over">
          <h2 className="banner__title">{view.result.winner === null ? 'Draw' : view.result.winner === HUMAN ? 'You win' : 'The AI wins'}</h2>
          <p className="banner__reason">{view.result.reason}</p>
          <button className="btn btn--primary" onClick={restart}>Play again</button>
        </div>
      )}
    </div>
  )
}
