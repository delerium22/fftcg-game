import { useEffect, useState, type JSX } from 'react'
import type { CardId, FieldCard, PlayerId, PlayerView } from '@fftcg/engine'
import { describeResult, fieldCardDisplay } from '../game/commands.js'
import type { Choice, ChoiceSet, GameApi } from '../game/types.js'
import { AI, HUMAN } from '../game/types.js'
import { Card } from './Card.js'
import { CardDetails } from './CardDetails.js'
import { CardGrid } from './CardGrid.js'
import { EventLog } from './EventLog.js'
import { PromptStrip } from './PromptStrip.js'

const MAX_DAMAGE = 7   // §12.2.2: a player with 7 damage loses

function defOf(v: PlayerView, id: CardId) {
  const inst = v.cards[id]
  return inst ? v.defs[inst.code] : undefined
}

/** One card on a field, wired to whatever choices target it. */
function FieldCardView({ v, c, choices, selected, onPick, onInspect, size }: {
  v: PlayerView; c: FieldCard; choices: Choice[]; selected: boolean; onPick: (id: CardId) => void
  onInspect: (code: string | undefined) => void; size: 'field' | 'small'
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
      text={d?.text}
      onClick={choices.length ? () => onPick(c.id) : undefined}
      onInspect={() => onInspect(d?.code)}
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
  // The card the player last pointed at, by CODE rather than by instance id: the panel shows what the CARD
  // does, which is a property of the definition, and a code survives the instance leaving play mid-look.
  // `action` rides along because it belongs to the INSTANCE, not the definition — two copies of one card
  // could in principle be paid for differently — so it is captured when the player looks, not looked up later.
  const [inspected, setInspected] = useState<{ code: string; action: string | null } | null>(null)
  const inspect = (code: string | undefined, action: string | null = null): void => {
    if (code !== undefined) setInspected({ code, action })
  }

  /**
   * What clicking this card will do, but ONLY when it does exactly one thing.
   *
   * That is the click which commits immediately, and the one that silently spent a 5-cost Odin on a 2-cost
   * Ramuh. A card offering several options does not commit on click — it opens the prompt strip, which lists
   * every option with this same label — so disclosing one of them here would name a payment the click is not
   * about to make.
   */
  const actionFor = (id: CardId): string | undefined => {
    const forCard = choices.byCard.get(id) ?? []
    return forCard.length === 1 ? forCard[0]?.label : undefined
  }

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
      <FieldCardView key={c.id} v={view} c={c} choices={choices.byCard.get(c.id) ?? []} selected={selected === c.id} onPick={pick} onInspect={inspect} size={kind === 'backups' ? 'small' : 'field'} />
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
        text={d?.text}
        onClick={() => pick(id)}
        onInspect={() => inspect(d?.code)}
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


      {/* `.table__seat--player` is column-reverse, so this list reads bottom-up on screen: the status bar sits
          at the outer edge and forwards end up nearest the prompt strip, meeting the AI's across it. */}
      {/* DOM ORDER IS THE READING AND TAB ORDER, and it deliberately differs from the visual layout: the
          grid places every section by explicit `grid-area`, so moving these in the markup moves nothing on
          screen. The prompt used to come FIRST, which meant a keyboard player at the mulligan reached
          "Keep hand", "Mulligan" and "Concede" — the irreversible controls — before reaching any of the
          five cards they were being asked about. Evidence before commitment: the opponent's board, then
          your own, then your hand, then the buttons. */}
      <section className="table__seat table__seat--player">
        <Seat v={view} p={HUMAN} active={view.priority === HUMAN || view.pending?.player === HUMAN} />
        <Zone label="Your Backups" compact empty={!view.fields[HUMAN].backups.length}>{field(HUMAN, 'backups')}</Zone>
        <Zone label="Your Forwards" empty={!view.fields[HUMAN].forwards.length}>{field(HUMAN, 'forwards')}</Zone>
      </section>

      <section className="table__hand">
        {orphanCards.length > 0 && <Zone label="Choose a card" compact empty={false}>{orphanCards}</Zone>}
        {/* The hand is a keyboard GRID: one tab stop, arrow keys within. Without it the mulligan cannot be
            reached by keyboard at all — no hand card is selectable there, so every one is a `role="img"`
            div outside the tab order, and the opening decision of the game is made blind. */}
        <CardGrid
          label="Your hand"
          className="hand"
          onFocusItem={(id) => inspect(defOf(view, id)?.code, actionFor(id) ?? null)}
          items={view.hand.map((id) => {
            const d = defOf(view, id)
            const forCard = choices.byCard.get(id) ?? []
            return {
              id,
              selectable: forCard.length > 0,
              render: (tabIndex) => (
                <Card
                  code={d?.code ?? '?'}
                  name={d?.name ?? 'Unknown'}
                  cost={d?.cost ?? 0}
                  elements={d?.elements ?? []}
                  type={d?.type ?? 'forward'}
                  power={d?.power ?? null}
                  selectable={forCard.length > 0}
                  selected={selected === id}
                  size="hand"
                  text={d?.text}
                  action={actionFor(id)}
                  tabIndex={tabIndex}
                  onClick={forCard.length ? () => pick(id) : undefined}
                  onInspect={() => inspect(d?.code, actionFor(id) ?? null)}
                />
              ),
            }
          })}
        />
      </section>

      <PromptStrip view={view} choices={choices} shown={shown} aiThinking={aiThinking} onChoose={(c) => { setSelected(null); choose(c) }} />


      <aside className="table__rail">
        <CardDetails def={inspected === null ? undefined : view.defs[inspected.code]} action={inspected === null ? null : inspected.action} />
        <EventLog log={log} />
      </aside>

      {view.result && (
        <div className="banner" role="alertdialog" aria-label="Game over">
          <h2 className="banner__title">{view.result.winner === null ? 'Draw' : view.result.winner === HUMAN ? 'You win' : 'The AI wins'}</h2>
          <p className="banner__reason">{describeResult(view.me, view.result)}</p>
          <button className="btn btn--primary" onClick={restart}>Play again</button>
        </div>
      )}
    </div>
  )
}
