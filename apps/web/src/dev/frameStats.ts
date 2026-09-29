/**
 * Frame-gap statistics over a sliding window, for the `?perf=1` overlay (UI overhaul U0) and the performance budget in
 * spec section 9: "no frame longer than 50 ms comes from the presentation layer". Pure, so it is testable without a
 * browser.
 */
export class FrameStats {
  private last: number | null = null
  private readonly gaps: number[] = []

  constructor(private readonly windowSize = 300) {}

  /** Record one animation frame's timestamp (a `requestAnimationFrame` callback argument). */
  frame(t: number): void {
    if (this.last !== null) {
      this.gaps.push(t - this.last)
      if (this.gaps.length > this.windowSize) this.gaps.shift()
    }
    this.last = t
  }

  get maxGapMs(): number {
    return this.gaps.length === 0 ? 0 : Math.max(...this.gaps)
  }

  get fps(): number {
    if (this.gaps.length === 0) return 0
    const mean = this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length
    return mean === 0 ? 0 : 1000 / mean
  }
}
