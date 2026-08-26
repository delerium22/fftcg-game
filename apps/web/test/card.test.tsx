import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMissingArt, markArtMissing } from '../src/game/art.js'
import { Card, type CardProps } from '../src/ui/Card.js'

// No jsdom in this repo (and none is being added), so the assertions run against the server-rendered
// markup instead of a DOM. That still covers what matters here: which element a card renders as, and
// that the text card carries every fact spec B-A5 needs when no image exists.
const html = (props: CardProps): string => renderToStaticMarkup(<Card {...props} />)

const cloud: CardProps = { code: '27-124S', name: 'Cloud', cost: 3, elements: ['earth'], type: 'forward', power: 7000 }
const shantotto: CardProps = { code: '12-120C', name: 'Shantotto', cost: 2, elements: ['earth', 'lightning'], type: 'forward', power: 7000 }

beforeEach(resetMissingArt)

describe('Card', () => {
  it('renders every printed fact without art (B-A5)', () => {
    markArtMissing(cloud.code)
    const out = html(cloud)
    expect(out).not.toContain('<img')
    for (const fact of ['Cloud', '>3<', 'forward', '7000', 'pip--earth', '27-124S']) expect(out).toContain(fact)
  })

  it('layers art over the text card, keeping the name plate', () => {
    const out = html(cloud)
    expect(out).toContain('src="/cards/27-124S.jpg"')
    expect(out).toContain('Cloud')
  })

  it('splits the frame between both elements of a dual-element card', () => {
    const out = html(shantotto)
    expect(out).toContain('--el-a:var(--el-earth)')
    expect(out).toContain('--el-b:var(--el-lightning)')
    expect(out).toContain('pip--lightning')
  })

  it('turns a dull card sideways', () => {
    expect(html({ ...cloud, dull: true })).toContain('is-dull')
    expect(html(cloud)).not.toContain('is-dull')
  })

  it('shows remaining power over printed power once damaged', () => {
    const out = html({ ...cloud, damage: 2000 })
    expect(out).toContain('5000')
    expect(out).toContain('/7000')
    expect(out).toContain('--dmg:28')
  })

  it('is a button only when selectable, and reports its selection', () => {
    expect(html({ ...cloud, selectable: true, selected: true })).toContain('<button type="button"')
    expect(html({ ...cloud, selectable: true, selected: true })).toContain('aria-pressed="true"')
    expect(html(cloud)).toContain('role="img"')
    expect(html(cloud)).not.toContain('<button')
  })

  it('shows nothing about a face-down card', () => {
    const out = html({ ...cloud, faceDown: true })
    expect(out).toContain('card__back')
    expect(out).not.toContain('Cloud')
    expect(out).not.toContain('27-124S')
  })
})
