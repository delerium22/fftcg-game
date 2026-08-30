import { useEffect, useRef, useState, type JSX } from 'react'
import type { CardId, FieldCard, PlayerId, PlayerView } from '@fftcg/engine'
import { displayName, fieldCardDisplay } from '../game/commands.js'
import type { Choice, ChoiceSet, GameApi } from '../game/types.js'
import { AI, HUMAN } from '../game/types.js'
import { Card, cardAccessibleName, type CardProps } from './Card.js'
import { CardDetails } from './CardDetails.js'
import { CardGrid, type GridItem } from './CardGrid.js'
import { EventLog } from './EventLog.js'
import { GameOverDialog } from './GameOverDialog.js'
import { PromptStrip } from './PromptStrip.js'

const MAX_DAMAGE = 7   // §12.2.2: a player with 7 damage loses

function defOf(v: PlayerView, id: CardId) {
  const inst = v.cards[id]
  return inst ? v.defs[inst.code] : undefined
}

/**
 * Everything a field card renders and announces, built ONCE.
 *
 * The card element and its grid cell both need this: inside a `CardGrid`, a card with no button of its own
 * is focused through the cell, so the cell carries the accessible name — and it must be the same name, from
 * the same numbers. Two spellings would drift somewhere only a screen-reader user ever goes.
 */
function fieldCardProps(v: PlayerView, c: FieldCard, selectable: boolean, size: 'field' | 'small'): CardProps {
  const d = defOf(v, c.id)
  // Spec C1-7: `effectivePower` (via `fieldCardDisplay`) is the ONE power authority, and the board is a
  // consumer of it. Passing printed `def.power` here would show a pumped Forward the wrong power AND the wrong
  // damage ratio, because `Card` derives remaining power and the damage bar from whatever number it is given.
  const shown = fieldCardDisplay(v, c)
  return {
    code: d?.code ?? '?',
    name: displayName(v, c.id),
    cost: d?.cost ?? 0,
    elements: d?.elements ?? [],
    type: d?.type ?? 'forward',
    power: shown.power,
    powerBonus: shown.powerBonus,
    granted: shown.granted,
    flags: shown.flags,
    damage: c.damage,
    dull: c.status === 'dull',
    selectable,
    size,
    ...(d?.text === undefined ? {} : { text: d.text }),
  }
}

/**
 * One labelled row of the board, navigable by keyboard.
 *
 * Every zone is a `CardGrid` for the same reason the hand is: a card nobody can click is a `role="img"` div
 * outside the tab order, and choosing a blocker means reading the attacker sitting on the opponent's side.
 * An EMPTY zone renders no grid at all — a grid with no cells has no tab stop to give and nothing to say,
 * and the four always-rendered field rows are empty for most of a game.
 */
function Zone({ label, items, compact, onLookAt }: {
  label: string
  items: readonly GridItem[]
  compact?: boolean
  onLookAt: (id: CardId) => void
}): JSX.Element {
  const empty = items.length === 0
  const cls = ['zone__cards', empty ? 'zone__cards--empty' : '', compact ? 'zone__cards--compact' : ''].filter(Boolean).join(' ')
  return (
    <div className="zone">
      <div className="zone__label">{label}</div>
      {empty
        ? <div className={cls} />
        : <CardGrid label={label} items={items} className={cls} onLookAt={onLookAt} />}
    </div>
  )
}

/** The public piles a player can open and read. Face-down zones (deck, the opponent's hand) are not here. */
export type PileKind = 'breakZone' | 'damageZone' | 'removedFromGame'
const PILE_LABEL: Record<PileKind, string> = {
  breakZone: 'Break Zone', damageZone: 'Damage', removedFromGame: 'Removed from game',
}

function Seat({ v, p, active, open, onToggle }: {
  v: PlayerView; p: PlayerId; active: boolean
  open: PileKind | null
  onToggle: (kind: PileKind) => void
}): JSX.Element {
  const f = v.fields[p]
  const you = p === HUMAN
  const damage = f.damageZone.length

  /**
   * A count that can be opened and read.
   *
   * These zones are PUBLIC information the board was showing only as a number — and the number is the part a
   * player can already see. Which cards are in a Break Zone decides whether Luso's Break-Zone mode is worth
   * choosing and whether Billy Bob is worth casting, both of which are answered BEFORE any target choice is
   * raised, so the orphan target row comes too late to help. Damage-zone identities are public too and are
   * how a player tracks what is left in a deck.
   *
   * A disclosure rather than a permanently visible row: the board's rows are fixed height, and a Break Zone
   * fills up over a game.
   */
  const pile = (kind: PileKind, count: number, inner: JSX.Element): JSX.Element => (
    <span className="stat">
      <span className="stat__label">{kind === 'damageZone' ? 'Damage' : kind === 'breakZone' ? 'Break' : 'Removed'}</span>
      {count === 0
        ? inner
        : (
          <button
            type="button"
            className="stat__open"
            aria-expanded={open === kind}
            aria-label={`${you ? 'Your' : "the AI's"} ${PILE_LABEL[kind]}, ${count} ${count === 1 ? 'card' : 'cards'}`}
            onClick={() => onToggle(kind)}
          >
            {inner}
          </button>
        )}
    </span>
  )

  return (
    <div className={active ? 'seat seat--active' : 'seat'}>
      <span className={you ? 'seat__name seat__name--you' : 'seat__name'}>{you ? 'You' : 'AI'}</span>
      <div className="seat__stats">
        <span className="stat"><span className="stat__label">Deck</span><span className="stat__value">{f.deck.length}</span></span>
        <span className="stat"><span className="stat__label">Hand</span><span className="stat__value">{you ? v.hand.length : f.handCount}</span></span>
        {pile('breakZone', f.breakZone.length, <span className="stat__value">{f.breakZone.length}</span>)}
        {pile('damageZone', damage, (
          // `aria-hidden`: inside a disclosure button the pip track would be announced twice, once as the
          // button's own name and once as this image. Outside one it is still the only thing that says
          // the damage total, so it keeps its label.
          <span className="damage-track" {...(damage === 0 ? { role: 'img', 'aria-label': `${damage} of ${MAX_DAMAGE} damage` } : { 'aria-hidden': true })}>
            {Array.from({ length: MAX_DAMAGE }, (_, i) => (
              <span key={i} className={i < damage ? 'damage-pip is-filled' : 'damage-pip'} />
            ))}
          </span>
        ))}
        {f.removedFromGame.length > 0
          && pile('removedFromGame', f.removedFromGame.length, <span className="stat__value">{f.removedFromGame.length}</span>)}
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

/**
 * Does clicking this card DO something, or merely select it?
 *
 * `pick` and `actionFor` must agree, and they stopped agreeing the moment E11 landed: `pick` began refusing
 * to execute a sole choice that hid several payments, while `actionFor` went on announcing that choice as
 * what the click submits. Seed 5's Hugh Yurg then read "Cast Hugh Yurg paying: …" on a button that only
 * selected it — the E4 invariant, that a card's stated action is what pressing it immediately does, broken by
 * the rung that made the click safer. The E4 tests could not see it: their fixtures build a `ChoiceSet`
 * without payment alternatives, so they still exercise the old world.
 *
 * One predicate, used by both, so they cannot drift apart a second time.
 */
const commitsOnClick = (forCard: readonly Choice[]): boolean =>
  forCard.length === 1 && !forCard[0]?.alternatives?.length

export function Board({ game }: { game: GameApi }): JSX.Element {
  const { view, choices, log, aiThinking, choose, restart } = game
  const [selected, setSelected] = useState<CardId | null>(null)
  // The card the player last pointed at, by CODE rather than by instance id: the panel shows what the CARD
  // does, which is a property of the definition, and a code survives the instance leaving play mid-look.
  // `action` rides along because it belongs to the INSTANCE, not the definition — two copies of one card
  // could in principle be paid for differently — so it is captured when the player looks, not looked up later.
  const [inspected, setInspected] = useState<{ code: string; card: CardId } | null>(null)
  /** The move whose other payments are being shown, or `null` for the ordinary strip (rung E11). */
  const [paying, setPaying] = useState<Choice | null>(null)
  const inspect = (code: string | undefined, card: CardId): void => {
    if (code !== undefined) setInspected({ code, card })
  }
  /**
   * What clicking the looked-at card does — RE-DERIVED each render, not captured with the look.
   *
   * The code above is captured, and rightly: it is a property of the definition and it survives the instance
   * leaving play mid-read, which is what you want when the card you are reading gets broken. The ACTION used
   * to be captured alongside it, and a snapshot cannot go stale gracefully — cast Luso from hand and the panel
   * went on reading "Luso … 4 ways to pay" while Luso stood on the field, describing a click that could no
   * longer be made. That is the defect G2 removed from the prompt strip, in the other half of the screen.
   *
   * Keying on the card ID keeps the reason the action was captured in the first place: it belongs to the
   * INSTANCE, not the definition, so two copies of one card can carry different actions. It just looks the
   * current one up instead of remembering an old one.
   */
  /**
   * Put focus back on the game after "Play again".
   *
   * The dialog is modal, so the button the player pressed is destroyed with it and the browser drops focus
   * to `document.body` — measured, not assumed. From there a keyboard player is tabbing in from the top of
   * the document to make the first decision of a brand new game, which is precisely the state this rung
   * exists to prevent at the END of one.
   */
  const restarting = useRef(false)
  useEffect(() => {
    if (!restarting.current || view.result) return
    const target = document.querySelector<HTMLButtonElement>('.prompt__actions button')
    // Keep waiting if there is nothing to focus YET. A new game's first decision is often the AI's — it
    // chooses who goes first — so on the render right after the restart the strip says "Waiting for the
    // opponent…" and offers no button at all. Consuming the flag there left focus on `document.body` until
    // the player tabbed in from the top of the document. The jsdom test missed it because its fixture
    // started past that decision; the real browser did not.
    if (!target) return
    restarting.current = false
    target.focus()
  }, [view])

  /** "The player is looking at this card", for every zone. Pointer and keyboard alike — see `CardGrid`. */
  const look = (id: CardId): void => { inspect(defOf(view, id)?.code, id) }

  // Which public pile is open, if any. One at a time: two open rows do not fit the board's fixed grid rows,
  // and a player is comparing against one pile at a time anyway.
  const [openPile, setOpenPile] = useState<{ p: PlayerId; kind: PileKind } | null>(null)
  const togglePile = (p: PlayerId, kind: PileKind): void =>
    setOpenPile((cur) => (cur?.p === p && cur.kind === kind ? null : { p, kind }))

  /**
   * The open pile's cards, as grid items — the same cells every other zone uses, so they read the same.
   *
   * `displayName` here too, and the review that caught this was right that it matters: open a Break Zone
   * holding two Lusos during a Billy Bob choice and the pile said "Luso" twice while the candidate row beside
   * it said "Luso (1)" and "Luso (2)". The player is looking at the same two cards in two rows that disagree
   * about what they are called. Four rows now, one namer.
   */
  const pileItems = (p: PlayerId, kind: PileKind): GridItem[] =>
    view.fields[p][kind].map((id) => {
      const d = defOf(view, id)
      return gridItem(id, {
        code: d?.code ?? '?',
        name: displayName(view, id),
        cost: d?.cost ?? 0,
        elements: d?.elements ?? [],
        type: d?.type ?? 'forward',
        power: d?.power ?? null,
        selectable: false,
        size: 'small',
        ...(d?.text === undefined ? {} : { text: d.text }),
      })
    })

  /**
   * Forget an open pile once it has emptied.
   *
   * `openPile` remembers a seat and a kind, not a set of cards, so a Break Zone whose last card is returned
   * to hand — Billy Bob does exactly that — left an orphaned labelled empty row behind. Merely declining to
   * RENDER that row is not enough: the state stayed set, so when the pile filled again it sprang open by
   * itself, `aria-expanded="true"`, with the player never having asked. Clearing it is the actual fix.
   */
  useEffect(() => {
    if (openPile !== null && view.fields[openPile.p][openPile.kind].length === 0) setOpenPile(null)
  }, [view, openPile])

  /** The opened pile's row, rendered under the seat that owns it. */
  const pileRow = (p: PlayerId): JSX.Element | null => {
    if (openPile === null || openPile.p !== p) return null
    const items = pileItems(p, openPile.kind)
    if (items.length === 0) return null
    const label = `${p === HUMAN ? 'Your' : "The AI's"} ${PILE_LABEL[openPile.kind]}`
    return <Zone label={label} compact items={items} onLookAt={look} />
  }

  /**
   * What clicking this card will do — ALWAYS, when it does anything at all.
   *
   * When the click commits, that is the exact action, and naming one of several options instead would state
   * a payment the click is not about to make (rung E4, and the click that silently spent a 5-cost Odin on a
   * 2-cost Ramuh). But saying NOTHING was the other half of that mistake: measured over six seeded games,
   * 38.6 % of clickable cards announced no action, and in 21.6 % of positions not one clickable card did.
   * Turn 1 shows six pressable cards under "cast, attack, or pass" and tells you nothing about any of them.
   *
   * So a card that does not commit says what pressing it DOES do — open a choice, and how big a choice.
   * `Cast Cloud, 4 ways to pay` was considered and rejected in review: that click selects Cloud, it does not
   * cast it, and naming the cast would be E4's defect wearing a hat. A bare count states only what is true,
   * and stays true when pressing an already-selected card closes the options again.
   *
   * The 38.6 % above was measured wrong, twice, and the corrected figure is worse: it counted the PREDICATE
   * rather than the rendered button, missing that this reached only the hand, and then a second measurement
   * treated two independent mutations as cumulative. Reverting both — the true pre-F6 state — leaves 403 of
   * 443 clickable cards silent, and 147 of 176 positions with nothing on the board saying anything.
   *
   * The two counts are different questions and are counted differently. Several MOVES is
   * `forCard.length` — each is its own entry. One move funded several ways is ONE entry whose
   * `alternatives` hold the rest, so it is `alternatives.length + 1`: the preferred payment plus the others.
   */
  const actionFor = (id: CardId): string | undefined => {
    const forCard = choices.byCard.get(id) ?? []
    if (forCard.length === 0) return undefined
    if (commitsOnClick(forCard)) return forCard[0]?.label
    if (forCard.length > 1) return `${forCard.length} options`
    const ways = (forCard[0]?.alternatives?.length ?? 0) + 1
    return `${ways} ways to pay`
  }

  const inspectedAction = inspected === null ? null : actionFor(inspected.card) ?? null

  // The choice set is rebuilt on every state change; a card selected under the old one may no longer be
  // clickable (or may not exist), so drop the selection rather than leave a highlight pointing at nothing.
  useEffect(() => { setSelected((id) => (id !== null && choices.byCard.has(id) ? id : null)) }, [choices])
  // And the payment view is dropped outright on any change of position (rung E11). Keeping it would leave the
  // strip offering payments for a move that may no longer be legal, which is the shape of the stale-selection
  // bug the line above exists to prevent — except that these buttons spend cards.
  useEffect(() => { setPaying(null) }, [choices])

  const pick = (id: CardId): void => {
    const forCard = choices.byCard.get(id) ?? []
    // One way to use a card: just do it. Several (a cast with options, a party to attack with): select it and
    // let the prompt strip show what they are, so a click is never a guess about which variant you got.
    //
    // A move with several PAYMENTS counts as several options (rung E11), even though it is one entry in
    // `byCard`. It used to commit on the first click, spending whichever of your cards `preferredPayment`
    // scored cheapest — a decision about your own hand you were never offered. An action that conceals a
    // choice is exactly the one that should not fire the instant you touch it.
    if (commitsOnClick(forCard)) {
      setSelected(null); setPaying(null); choose(forCard[0] as Choice); return
    }
    setPaying(null)
    setSelected((cur) => (cur === id ? null : id))
  }

  // Concede is legal in every state (§2.1), so `legalCommands` puts it first — which would make it the leftmost,
  // most-reachable button on the strip all game. Sort it to the end; nothing else changes order.
  const order = (c: Choice) => (c.command.type === 'concede' ? 1 : 0)
  const base = (selected === null ? choices.loose : [...(choices.byCard.get(selected) ?? []), ...choices.loose])
    .slice().sort((a, b) => order(a) - order(b))
  // Asking to pay differently REPLACES the strip with that move's payments, rather than adding them to it.
  // Spec B6 collapsed payments because `legalCommands` explodes — one action reached thirty exact payments in
  // a twelve-seed trace — and listing them alongside everything else would rebuild the interface B6 removed.
  // So the alternatives are a place you go, with a way back, not a longer list of buttons.
  const shown = paying ? [paying, ...paying.alternatives ?? []] : base
  // Backups render small: they are CP sources rather than combat units, and with auto-pay (spec B6) they are
  // rarely a click target — which also buys the vertical room two full-size field rows per side would not fit in.
  /**
   * One `GridItem` from a set of card props.
   *
   * The single place a card's cell learns what to announce. `cellName` and `cellDescribedBy` are always
   * supplied and `CardGrid` decides whether to use them, so the "cell announces only when it is the focus
   * target" rule lives in exactly one file.
   */
  const gridItem = (
    id: CardId,
    props: CardProps,
    // Narrowed to what callers actually vary. As `Partial<CardProps>` it advertised more than it delivers:
    // `selectable`, `text` and `presentational` are derived from `props` alone, so an override of those in
    // `extra` would name the card one way and focus, describe and hide it another. Latent rather than live —
    // no caller passed them — but a contract that is broader than its implementation is an invitation.
    extra: { selected?: boolean; onClick?: (() => void) | undefined } = {},
  ): GridItem => {
    const descriptionId = `card-desc-${id}`
    return {
      id,
      selectable: props.selectable === true,
      cellName: cardAccessibleName({ ...props, ...extra }),
      ...(props.text ? { cellDescribedBy: descriptionId } : {}),
      render: (tabIndex) => (
        <Card
          {...props}
          {...extra}
          tabIndex={tabIndex}
          descriptionId={descriptionId}
          presentational={props.selectable !== true}
        />
      ),
    }
  }

  const field = (p: PlayerId, kind: 'forwards' | 'backups'): GridItem[] =>
    view.fields[p][kind].map((c) => {
      const selectable = (choices.byCard.get(c.id) ?? []).length > 0
      // The action, which a field card never carried. A Forward whose sole choice is `Block with Luso`
      // COMMITS when pressed and announced only its power — the same silence as a hand card, on the row
      // where the click is most often irreversible.
      const props = {
        ...fieldCardProps(view, c, selectable, kind === 'backups' ? 'small' : 'field'),
        ...(actionFor(c.id) === undefined ? {} : { action: actionFor(c.id) }),
      }
      return gridItem(c.id, props, {
        selected: selected === c.id,
        ...(selectable ? { onClick: () => pick(c.id) } : {}),
      })
    })

  // Every clickable choice must be reachable, or the game dead-ends: Billy Bob's ETB targets your BREAK ZONE,
  // which the board otherwise shows only as a count, so its answer lived entirely in `byCard` under an id no
  // Card rendered — leaving Concede as the only button while the strip said "click a highlighted card".
  // Rather than special-case the Break Zone, gather ANY targetable card the board does not already draw and
  // give it a row. That closes the class (C2/C3 target more hidden zones) instead of this one instance.
  const orphanTargets = orphanTargetIds(view, choices)
  const orphanCards: GridItem[] = orphanTargets.map((id) => {
    const d = defOf(view, id)
    return gridItem(id, {
      code: d?.code ?? '?',
      name: displayName(view, id),
      cost: d?.cost ?? 0,
      elements: d?.elements ?? [],
      type: d?.type ?? 'forward',
      power: d?.power ?? null,
      selectable: true,
      size: 'small',
      ...(d?.text === undefined ? {} : { text: d.text }),
      // And here too. Every card in this row is selectable BY CONSTRUCTION — it exists only because a choice
      // named it — so one that says nothing about its action is the worst case of the three: a card the
      // player has never seen, in a row that appeared for reasons the board does not explain, offering a
      // press whose effect is unstated. A Hugh Yurg deck-search candidate COMMITS `Play X onto the field`.
      ...(actionFor(id) === undefined ? {} : { action: actionFor(id) }),
    }, { selected: selected === id, onClick: () => pick(id) })
  })

  return (
    <div className="table">
      <section className="table__seat table__seat--opponent">
        <Seat
          v={view} p={AI} active={view.priority === AI || view.pending?.player === AI}
          open={openPile?.p === AI ? openPile.kind : null}
          onToggle={(kind) => togglePile(AI, kind)}
        />
        {pileRow(AI)}
        <Zone label="AI Backups" compact items={field(AI, 'backups')} onLookAt={look} />
        <Zone label="AI Forwards" items={field(AI, 'forwards')} onLookAt={look} />
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
        <Seat
          v={view} p={HUMAN} active={view.priority === HUMAN || view.pending?.player === HUMAN}
          open={openPile?.p === HUMAN ? openPile.kind : null}
          onToggle={(kind) => togglePile(HUMAN, kind)}
        />
        {pileRow(HUMAN)}
        <Zone label="Your Backups" compact items={field(HUMAN, 'backups')} onLookAt={look} />
        <Zone label="Your Forwards" items={field(HUMAN, 'forwards')} onLookAt={look} />
      </section>

      <section className="table__hand">
        {orphanCards.length > 0 && <Zone label="Choose a card" compact items={orphanCards} onLookAt={look} />}
        {/* The hand is a keyboard GRID: one tab stop, arrow keys within. Without it the mulligan cannot be
            reached by keyboard at all — no hand card is selectable there, so every one is a `role="img"`
            div outside the tab order, and the opening decision of the game is made blind. */}
        <CardGrid
          label="Your hand"
          className="hand"
          onLookAt={look}
          items={view.hand.map((id) => {
            const d = defOf(view, id)
            const forCard = choices.byCard.get(id) ?? []
            const selectable = forCard.length > 0
            // The SAME occurrence marker the buttons use. A button saying "Discard Shantotto (2)" is only
            // useful if the player can see which rendered card is Shantotto (2) — a disambiguator that
            // appears on one side of the interface and not the other is worse than none, because it looks
            // like an answer.
            return gridItem(id, {
              code: d?.code ?? '?',
              name: displayName(view, id),
              cost: d?.cost ?? 0,
              elements: d?.elements ?? [],
              type: d?.type ?? 'forward',
              power: d?.power ?? null,
              selectable,
              size: 'hand',
              ...(d?.text === undefined ? {} : { text: d.text }),
              ...(actionFor(id) === undefined ? {} : { action: actionFor(id) }),
            }, {
              selected: selected === id,
              ...(selectable ? { onClick: () => pick(id) } : {}),
            })
          })}
        />
      </section>

      <PromptStrip
        view={view} choices={choices} shown={shown} aiThinking={aiThinking}
        paying={paying} onPay={setPaying}
        onChoose={(c) => { setSelected(null); setPaying(null); choose(c) }}
      />


      <aside className="table__rail">
        <CardDetails def={inspected === null ? undefined : view.defs[inspected.code]} action={inspectedAction} />
        <EventLog log={log} silenced={view.result !== null} />
      </aside>

      {view.result && <GameOverDialog result={view.result} me={view.me} onRestart={() => { restarting.current = true; restart() }} />}
    </div>
  )
}
