// Token and quota figures: pure helpers the pane and the turn hook share.

import type { StackNode } from '../types'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A bar of `width` cells, `▓` for the used share. */
export function bar(percent: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))

  return '▓'.repeat(filled) + '░'.repeat(width - filled)
}

/** Green below half, amber to 80%, red past it. */
export function levelColor(percent: number): string {
  return percent < 50 ? 'success' : percent < 80 ? 'warning' : 'error'
}

/** When a window resets: a clock time within a day, a weekday after. */
export function resetLabel(iso: string, now: number): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  if (at.getTime() - now < DAY_MS) {
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  }

  return WEEKDAYS[at.getDay()] ?? ''
}

export function shortTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`

  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** One finished turn counted on the active entry: a turn and its output tokens. */
export function addTurn(nodes: readonly StackNode[], outTokens: number): StackNode[] {
  return nodes.map(n =>
    n.state === 'active' ? { ...n, turns: (n.turns ?? 0) + 1, outTokens: (n.outTokens ?? 0) + outTokens } : n,
  )
}

/** An entry's turns and output tokens with everything beneath it. */
export function rollup(nodes: readonly StackNode[], id: string): { turns: number; outTokens: number } {
  return nodes
    .filter(n => n.id === id || n.id.startsWith(`${id}.`))
    .reduce((sum, n) => ({ turns: sum.turns + (n.turns ?? 0), outTokens: sum.outTokens + (n.outTokens ?? 0) }), {
      turns: 0,
      outTokens: 0,
    })
}
