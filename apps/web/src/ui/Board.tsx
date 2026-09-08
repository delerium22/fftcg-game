import { useEffect, useRef, useState, type JSX, useMemo } from 'react'
import type { CardId, Element, FieldCard, GameState, Payment, PlayerId, PlayerView } from '@fftcg/engine'
import { castBlockerText, displayName, fieldCardDisplay, headline, stateShim } from '../game/commands.js'
import { candidatesFor, commandFor, completedChoice as completedSelection, extendableWith, refusal, selectionText, setKindFor, toggled, type Selection } from '../game/selection.js'
import { SelectionTray } from './SelectionTray.js'
import {
  EMPTY_PAYMENT, candidateSources, completedChoice, crystals, extendable, generatedFor, legalPaymentsOf, needsTray,
  paidText, requirementFor, withBackup, withDiscard,
} from '../game/payment.js'
import type { Choice, ChoiceSet, GameApi } from '../game/types.js'
import { AI, HUMAN } from '../game/types.js'
import { Card, cardAccessibleName, type CardProps } from './Card.js'
import { CardDetails } from './CardDetails.js'
import { CardGrid, type GridItem } from './CardGrid.js'
import { CardSheet, type SheetAction } from './CardSheet.js'
import { EventLog } from './EventLog.js'
import { GameOverDialog } from './GameOverDialog.js'
import { PaymentTray } from './PaymentTray.js'
import { PromptStrip } from './PromptStrip.js'

/**
 * The payment being built (rung I2): the move, the sources picked so far, and a two-element discard waiting
 * for its element. Dropped on any change of position, as E11's payment view was — its buttons spend cards.
 */
interface Paying {
  choice: Choice
  selection: Payment
  ask: { card: CardId; options: Element[] } | null
}

const MAX_DAMAGE = 7   // §12.4.1: a player with 7 damage loses

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
function fieldCardProps(v: PlayerView, c: FieldCard, actionable: boolean, size: 'field' | 'small', shim: GameState): CardProps {
  const d = defOf(v, c.id)
  // Spec C1-7: `effectivePower` (via `fieldCardDisplay`) is the ONE power authority, and the board is a
  // consumer of it. Passing printed `def.power` here would show a pumped Forward the wrong power AND the wrong
  // damage ratio, because `Card` derives remaining power and the damage bar from whatever number it is given.
  const shown = fieldCardDisplay(v, c, shim)
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
    actionable,
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

export function Board({ game, onHelp }: {
  game: GameApi
  /** Opens the "How to play" sheet (rung H1). Absent in tests that never asked for one, so nothing renders. */
  onHelp?: (() => void) | undefined
}): JSX.Element {
  const { view, choices, log, aiThinking, choose, restart } = game
  // Rung J6-D7: one engine shim per render for the three readers (power, keywords, flags), not one per card.
  const shim = useMemo(() => stateShim(view), [view])
  /** The card whose sheet is open (rung I1), or null. */
  const [sheet, setSheet] = useState<CardId | null>(null)
  // The card the player last pointed at, by CODE rather than by instance id: the panel shows what the CARD
  // does, which is a property of the definition, and a code survives the instance leaving play mid-look.
  // The CARD ID rides along because the action belongs to the INSTANCE, not the definition — two copies of one
  // card can be paid for differently. The action itself is looked up live (see `inspectedAction`); it used to
  // be captured here alongside the code, and a snapshot cannot go stale gracefully.
  const [inspected, setInspected] = useState<{ code: string; card: CardId } | null>(null)
  /**
   * Forget what was being looked at when a NEW GAME starts.
   *
   * Card ids are minted from 1 per game and `Board` stays mounted across "Play again", so an id captured in
   * the old game names a different card in the new one — and the panel would attach that card's action to a
   * card the player never inspected. A code review found it; checking the captured code does NOT fix it,
   * because with a fixed deck order the reused id carries the same code and the mismatch stays invisible right
   * up until deck construction changes.
   *
   * Detected from the view rather than from a game id threaded through `GameApi`: only a fresh game is at turn
   * 0 in the setup phase, and on the very first render `inspected` is already null, so this costs nothing.
   * Remounting the whole board on a new key would also work and would clear every piece of per-game UI state
   * at once — but it would reset the `restarting` ref below, which is what puts focus back on the new game
   * after "Play again" (rung E7).
   */
  useEffect(() => {
    if (view.turn === 0 && view.phase === 'setup') setInspected(null)
  }, [view.turn, view.phase])

  /** The payment being built (rung I2), or `null` for the ordinary strip. */
  const [paying, setPaying] = useState<Paying | null>(null)
  /** The set being built (rung J7-D3): an attack party, a target set, the cards to discard. */
  const [selecting, setSelecting] = useState<Selection | null>(null)
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
        actionable: false,
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
   * What pressing this card offers — its sole choice's headline, or how many choices its sheet will list.
   *
   * F6 gave every pressable card an action in one of three forms, chosen by what the click would DO: the exact
   * label when it committed, a bare count when it only selected. Since rung I1 no press commits — every one
   * opens the card's sheet — so the forms are two: the HEADLINE of the sole choice ("Cast Ramuh", "Block with
   * Luso"; never a payment, which the tray has yet to choose), or `N options`. A card with nothing to do says
   * nothing: its sheet is for reading.
   *
   * While a payment is being built (I2) the board's actions are the tray's, not the game's: a candidate
   * source says what picking it spends.
   */
  /** Rung J7-D2: when the list is a sample, every candidate of the set decision glows and offers the picker. */
  const sampledCandidate = (id: CardId): boolean => {
    if (!choices.capped) return false
    const k = setKindFor(view)
    return k !== null && candidatesFor(view, k).includes(id)
  }
  const actionFor = (id: CardId): string | undefined => {
    if (paying) return sourceAction(id)
    if (selecting) {
      if (selecting.chosen.includes(id)) return 'Chosen — press to put back'
      return extendableWith(view, selecting, id) ? 'Press to add' : undefined
    }
    const forCard = choices.byCard.get(id) ?? []
    if (forCard.length === 0) return sampledCandidate(id) ? 'Choose several…' : undefined
    if (forCard.length === 1) return headline(view, forCard[0] as Choice)
    return `${forCard.length} options`
  }

  // ---- the payment tray (rung I2) ------------------------------------------------------------------------
  const legal = paying ? legalPaymentsOf(paying.choice) : []
  const candidates = paying ? candidateSources(legal) : null
  const requirement = paying ? requirementFor(view, paying.choice) : null
  const cp = paying && requirement ? generatedFor(view, paying.selection, requirement) : []
  const lit = requirement ? crystals(requirement, cp) : []
  const completed = paying ? completedChoice(paying.choice, paying.selection) : null
  const backupsOf = (p: PlayerId): Set<CardId> => new Set(view.fields[p].backups.map((c) => c.id))

  /** Is this card a source the tray may take right now — a candidate that is picked, or still addable? */
  const sourceState = (id: CardId): { role: 'dull' | 'discard' | null; offered: boolean; elements: Element[] } => {
    if (!paying || !candidates) return { role: null, offered: false, elements: [] }
    const sel = paying.selection
    if (backupsOf(HUMAN).has(id)) {
      if (sel.dullBackups.includes(id)) return { role: 'dull', offered: true, elements: [] }
      return { role: null, offered: candidates.backups.has(id) && extendable(legal, sel, { backup: id }), elements: [] }
    }
    const declared = sel.discards.find((d) => d.card === id)
    if (declared) return { role: 'discard', offered: true, elements: [declared.element] }
    const options = (candidates.discards.get(id) ?? []).filter((e) => extendable(legal, sel, { discard: id, element: e }))
    return { role: null, offered: options.length > 0, elements: options }
  }
  const sourceAction = (id: CardId): string | undefined => {
    const st = sourceState(id)
    if (st.role === 'dull') return 'Picked: dull for 1 CP — press to put back'
    if (st.role === 'discard') return `Picked: discard for 2 ${st.elements[0]} CP — press to put back`
    if (!st.offered) return undefined
    if (backupsOf(HUMAN).has(id)) return 'Dull for 1 CP'
    return st.elements.length === 1 ? `Discard for 2 ${st.elements[0]} CP` : 'Discard for 2 CP'
  }
  /** Toggle a source in the payment being built. */
  const toggleSource = (id: CardId): void => {
    if (!paying) return
    const st = sourceState(id)
    const sel = paying.selection
    if (st.role === 'dull') { setPaying({ ...paying, selection: withBackup(sel, id, false), ask: null }); return }
    if (st.role === 'discard') { setPaying({ ...paying, selection: withDiscard(sel, id, null), ask: null }); return }
    if (!st.offered) return
    if (backupsOf(HUMAN).has(id)) { setPaying({ ...paying, selection: withBackup(sel, id, true), ask: null }); return }
    // A two-element card asks which element only when both would still lead somewhere (I2-D4).
    if (st.elements.length === 1) { setPaying({ ...paying, selection: withDiscard(sel, id, st.elements[0] as Element), ask: null }); return }
    setPaying({ ...paying, ask: { card: id, options: st.elements } })
  }
  const startPaying = (c: Choice): void => { setSheet(null); setPaying({ choice: c, selection: EMPTY_PAYMENT, ask: null }) }

  const tray = paying && requirement ? (
    <PaymentTray
      crystals={lit}
      complete={completed !== null}
      ask={paying.ask ? { card: paying.ask.card, name: displayName(view, paying.ask.card), options: paying.ask.options } : null}
      onAuto={() => setPaying({ ...paying, selection: legal[0] ?? EMPTY_PAYMENT, ask: null })}
      onClear={() => setPaying({ ...paying, selection: EMPTY_PAYMENT, ask: null })}
      onCancel={() => setPaying(null)}
      onConfirm={() => { if (completed) { setPaying(null); choose(completed) } }}
      onDeclare={(card, element) => setPaying({ ...paying, selection: withDiscard(paying.selection, card, element), ask: null })}
    />
  ) : null
  const selectionTray = selecting ? (
    <SelectionTray
      chosen={selecting.chosen}
      name={(id) => displayName(view, id)}
      refusal={refusal(view, selecting)}
      onClear={() => setSelecting({ ...selecting, chosen: [] })}
      onCancel={() => setSelecting(null)}
      onConfirm={() => { const c = completedSelection(view, selecting); if (c) { setSelecting(null); choose(c) } }}
      onRemove={(id) => setSelecting(toggled(selecting, id))}
    />
  ) : null
  const payingPrompt = paying ? `Paying for: ${headline(view, paying.choice)} — ${paidText(lit)}`
    : selecting ? selectionText(view, selecting, (id) => displayName(view, id)) : null

  const inspectedAction = inspected === null ? null : actionFor(inspected.card) ?? null

  // The payment being built is dropped outright on any change of position (rung E11, kept by I2). Keeping it
  // would leave the tray spending cards against a move that may no longer be legal. The SHEET survives a
  // change of position: it is for reading, and its actions are re-derived live on every render, so a sheet
  // opened on the AI's Forward while the AI thinks simply stops offering "Block with" once the attack is over.
  useEffect(() => { setPaying(null); setSelecting(null) }, [choices])

  /**
   * A press on a card (rung I1): while a payment is being built it picks or puts back a source; otherwise it
   * opens the card's sheet. It never commits a command — that is the sheet's job, after the card has been
   * read. The click used to commit a sole choice at once and select otherwise, and the two behaviours on one
   * board were the confusion F6 measured.
   */
  const pick = (id: CardId): void => {
    if (paying) {
      if (sourceState(id).offered) { toggleSource(id); return }
      setSheet(id); return
    }
    if (selecting) {
      if (selecting.chosen.includes(id) || extendableWith(view, selecting, id)) { setSelecting(toggled(selecting, id)); return }
      setSheet(id); return
    }
    setSheet(id)
  }

  // Concede is legal in every state (§2.1), so `legalCommands` puts it first — which would make it the leftmost,
  // most-reachable button on the strip all game. Sort it to the end; nothing else changes order.
  const order = (c: Choice) => (c.command.type === 'concede' ? 1 : 0)
  // Only the subjectless choices (I1-D6): a card's own choices live on its sheet now.
  const shown = choices.loose.slice().sort((a, b) => order(a) - order(b))
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
    // Every face-up card is a button now (rung I1), so the button is always the focus target and the cell
    // never has to announce for it. `cellName` is still supplied: `CardGrid` decides, in one place.
    const pressable = props.faceDown !== true
    return {
      id,
      selectable: pressable,
      cellName: cardAccessibleName({ ...props, ...extra }),
      ...(props.text ? { cellDescribedBy: descriptionId } : {}),
      render: (tabIndex) => (
        <Card
          {...props}
          {...extra}
          tabIndex={tabIndex}
          descriptionId={descriptionId}
          presentational={!pressable}
          onClick={extra.onClick ?? (() => pick(id))}
        />
      ),
    }
  }

  /** Whether a card glows: a key of `byCard`, or — while paying — a source the tray offers or has taken. */
  const glows = (id: CardId): boolean =>
    paying ? sourceState(id).offered
      : selecting ? selecting.chosen.includes(id) || extendableWith(view, selecting, id)
      : (choices.byCard.get(id) ?? []).length > 0 || sampledCandidate(id)
  const chosenNow = (id: CardId): boolean => selecting !== null && selecting.chosen.includes(id)
  const payingRole = (id: CardId): 'dull' | 'discard' | undefined => sourceState(id).role ?? undefined

  const field = (p: PlayerId, kind: 'forwards' | 'backups'): GridItem[] =>
    view.fields[p][kind].map((c) => {
      // The action, which a field card never carried. A Forward whose sole choice is `Block with Luso`
      // announced only its power — the same silence as a hand card, on the row where the decision is most
      // often irreversible.
      const props: CardProps = {
        ...fieldCardProps(view, c, glows(c.id), kind === 'backups' ? 'small' : 'field', shim),
        ...(actionFor(c.id) === undefined ? {} : { action: actionFor(c.id) }),
        ...(payingRole(c.id) === undefined ? {} : { paying: payingRole(c.id) }),
        ...(chosenNow(c.id) ? { chosen: true } : {}),
      }
      return gridItem(c.id, props, { selected: sheet === c.id })
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
      actionable: true,
      size: 'small',
      ...(d?.text === undefined ? {} : { text: d.text }),
      // And here too. Every card in this row is actionable BY CONSTRUCTION — it exists only because a choice
      // named it — so one that says nothing about its action is the worst case of the three: a card the
      // player has never seen, in a row that appeared for reasons the board does not explain, offering a
      // press whose effect is unstated.
      ...(actionFor(id) === undefined ? {} : { action: actionFor(id) }),
    }, { selected: sheet === id })
  })

  /**
   * The open card's sheet (rung I1), built from the LIVE choice set — never a snapshot, for the reason
   * `inspectedAction` gives: a snapshot cannot go stale gracefully. While a payment is being built the sheet
   * is read-only (no nested flows): its actions are the tray's, on the board.
   */
  const sheetProps = (id: CardId): JSX.Element | null => {
    const d = defOf(view, id)
    if (!d) return null
    const onField = ([0, 1] as const).flatMap((p) => [...view.fields[p].forwards, ...view.fields[p].backups]).find((c) => c.id === id)
    const face: CardProps = onField
      ? fieldCardProps(view, onField, false, 'field', shim)
      : { code: d.code, name: displayName(view, id), cost: d.cost, elements: d.elements, type: d.type, power: d.power, ...(d.text === undefined ? {} : { text: d.text }) }
    const forCard = paying || selecting ? [] : (choices.byCard.get(id) ?? [])
    // Rung J7-D3: when the decision is a SET this card may join, its several-member commands collapse into
    // one "Choose several…" action that starts the picker with this card; a singleton stays a plain commit.
    const setKind = setKindFor(view)
    const joins = setKind !== null && candidatesFor(view, setKind).includes(id)
    const members = (c: Choice): number => {
      const cmd = c.command
      return cmd.type === 'declareAttack' ? cmd.attackers.length : cmd.type === 'chooseTargets' ? cmd.targets.length
        : cmd.type === 'discardToHandSize' || cmd.type === 'breakExcessBackups' ? cmd.cards.length : 1
    }
    const singles = joins ? forCard.filter((c) => members(c) <= 1) : forCard
    const actions: SheetAction[] = singles.map((c) => ({
      choice: c, kind: needsTray(c) ? 'pay' : 'commit',
      label: needsTray(c) ? headline(view, c) : c.label,
    }))
    if (joins && setKind !== null) {
      const first = forCard[0] ?? { command: commandFor(view, { kind: setKind, chosen: [id] }), label: '', card: id }
      const verb = setKind === 'attackers' ? 'Attack with several…' : setKind === 'discards' ? 'Discard several…' : setKind === 'backups' ? 'Put several into the Break Zone…' : 'Choose several…'
      actions.push({ choice: first, kind: 'select', label: verb })
    }
    const castable = forCard.some((c) => c.command.type === 'castCharacter' || c.command.type === 'castSummon')
    const castBlocked = paying ? null : castBlockerText(view, id, castable)
    return (
      <CardSheet
        face={face} def={d} actions={actions} castBlocked={castBlocked}
        onCommit={(c) => { setSheet(null); setPaying(null); choose(c) }}
        onPay={startPaying}
        onSelect={() => { const k = setKindFor(view); if (k) { setSheet(null); setSelecting({ kind: k, chosen: [id] }) } }}
        onClose={() => setSheet(null)}
      />
    )
  }

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
              actionable: glows(id),
              size: 'hand',
              ...(d?.text === undefined ? {} : { text: d.text }),
              ...(actionFor(id) === undefined ? {} : { action: actionFor(id) }),
              ...(payingRole(id) === undefined ? {} : { paying: payingRole(id) }),
              ...(chosenNow(id) ? { chosen: true } : {}),
            }, { selected: sheet === id })
          })}
        />
      </section>

      <PromptStrip
        view={view} choices={choices} shown={shown} aiThinking={aiThinking}
        tray={tray ?? selectionTray} paying={payingPrompt}
        onChoose={(c) => { setPaying(null); setSelecting(null); choose(c) }}
        autoPass={game.autoPass ?? false} onAutoPass={game.setAutoPass}
      />

      {sheet !== null && sheetProps(sheet)}


      <aside className="table__rail">
        {/* Rung H1: the way back to the rules. A ghost button, above the details it competes with least. */}
        {onHelp && (
          <div className="rail__help">
            <button type="button" className="btn btn--ghost" onClick={onHelp}>How to play</button>
          </div>
        )}
        <CardDetails def={inspected === null ? undefined : view.defs[inspected.code]} action={inspectedAction} />
        <EventLog log={log} silenced={view.result !== null} />
      </aside>

      {view.result && <GameOverDialog result={view.result} me={view.me} onRestart={() => { restarting.current = true; restart() }} />}
    </div>
  )
}
