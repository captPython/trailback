// The stack itself: pure functions over the node list, no `$`, so the tests
// hold them directly and the hooks module only moves values in and out.

import type { StackNode, StackState } from '../types'

export type StackOp =
  | { op: 'push'; id: string; title: string }
  | { op: 'add'; id: string; title: string; state?: StackState }
  | { op: 'pop'; id?: string }
  | { op: 'status'; id: string; state: StackState; title?: string }
  | { op: 'focus'; id: string }
  | { op: 'jump'; id: string }
  | { op: 'complete'; id: string }
  | { op: 'remove'; id: string }
  | { op: 'reset' }

export const STATES: readonly StackState[] = ['active', 'followup', 'blocked', 'suspended', 'pending', 'done']

/** Theme keys, so the pane follows the person's light, dark or colorblind theme. */
export const COLOR: Record<StackState, string> = {
  active: 'success',
  followup: 'suggestion',
  blocked: 'error',
  suspended: 'claude',
  pending: 'inactive',
  done: 'success',
}

/** One hue per tree depth, cycling: guides and ids take their level's. */
const DEPTH = ['planMode', 'autoAccept', 'bashBorder', 'warning']

export function depthColor(depth: number): string {
  return DEPTH[depth % DEPTH.length] ?? 'subtle'
}

/** The states loud enough to earn a filled badge at the row's end. */
export const BADGE: Partial<Record<StackState, string>> = {
  active: 'ACTIVE',
  followup: 'FOLLOW-UP',
  blocked: 'BLOCKED',
}

export const LABEL: Record<StackState, string> = {
  active: 'active',
  followup: 'follow-up',
  blocked: 'blocked',
  suspended: 'suspended',
  pending: 'pending',
  done: 'done',
}

export const STILL: Record<StackState, string> = {
  active: '▶',
  followup: '◎',
  blocked: '✕',
  suspended: '◐',
  pending: '○',
  done: '✓',
}

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const PULSE = ['◌', '○', '◎', '●', '◎', '○']
const SETTLE = ['▶', '▷', '✓']

const SPIN_MS = 100
const PULSE_MS = 180
const BLINK_MS = 600
const SETTLE_MS = 100
const FLASH_MS = 600

const ID = /^[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$/

function checkId(id: unknown): string {
  if (typeof id !== 'string' || !ID.test(id)) {
    throw new Error(`invalid id ${JSON.stringify(id)}: use dotted segments like 1.3.1`)
  }

  return id
}

function isAncestor(maybe: string, of: string): boolean {
  return of.startsWith(`${maybe}.`)
}

function compareIds(a: string, b: string): number {
  const as = a.split('.')
  const bs = b.split('.')
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const x = as[i] ?? ''
    const y = bs[i] ?? ''
    if (x === y) continue
    const nx = Number(x)
    const ny = Number(y)

    return Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x < y ? -1 : 1
  }

  return as.length - bs.length
}

function withState(node: StackNode, state: StackState, now: number): StackNode {
  if (node.state === state) return node
  const { isParked: _, ...rest } = node

  // A pause ends when the entry is taken up again or finished.
  return state === 'active' || state === 'done' ? { ...rest, state, changedAt: now } : { ...node, state, changedAt: now }
}

/** Whether `n` is paused by a jump, or holds a paused entry beneath it. */
function holdsParked(nodes: readonly StackNode[], n: StackNode): boolean {
  return nodes.some(p => p.isParked && (p.id === n.id || isAncestor(n.id, p.id)))
}

/** Makes `id` the one active node: its ancestors suspend, the old chain parks as pending. */
function activate(nodes: StackNode[], id: string, now: number): StackNode[] {
  return nodes.map(n => {
    if (n.id === id) return withState(n, 'active', now)
    if (isAncestor(n.id, id)) return withState(n, 'suspended', now)
    if (n.state === 'active' && n.isParked) return withState(n, 'suspended', now)
    if (n.state === 'suspended' && holdsParked(nodes, n)) return n
    if (n.state === 'active' || n.state === 'suspended') return withState(n, 'pending', now)

    return n
  })
}

/** Marks `id` done and hands focus to its nearest ancestor still open. */
function finish(nodes: StackNode[], id: string, now: number): StackNode[] {
  const done = nodes.map(n => (n.id === id ? withState(n, 'done', now) : n))
  const parent = done
    .filter(n => isAncestor(n.id, id) && n.state !== 'done')
    .sort((a, b) => b.id.length - a.id.length)[0]

  return parent ? activate(done, parent.id, now) : done
}

function upsert(nodes: StackNode[], id: string, title: string, state: StackState, now: number): StackNode[] {
  const found = nodes.find(n => n.id === id)
  if (!found) return [...nodes, { id, title, state, createdAt: now, changedAt: now }]

  return nodes.map(n => (n.id === id ? { ...withState(n, state, now), title: title || n.title } : n))
}

function need(nodes: readonly StackNode[], id: string): void {
  if (!nodes.some(n => n.id === id)) throw new Error(`no stack entry ${id}`)
}

export function applyOp(nodes: readonly StackNode[], op: StackOp, now: number): StackNode[] {
  const list = [...nodes]
  switch (op.op) {
    case 'push': {
      const id = checkId(op.id)

      return activate(upsert(list, id, op.title, 'pending', now), id, now)
    }
    case 'add': {
      const id = checkId(op.id)
      const state = op.state ?? 'pending'
      const added = upsert(list, id, op.title, state === 'active' ? 'pending' : state, now)

      return state === 'active' ? activate(added, id, now) : added
    }
    case 'pop': {
      const id = op.id === undefined ? list.find(n => n.state === 'active')?.id : checkId(op.id)
      if (id === undefined) throw new Error('nothing to pop: no active entry')
      need(list, id)

      return finish(list, id, now)
    }
    case 'focus': {
      const id = checkId(op.id)
      need(list, id)

      return activate(list, id, now)
    }
    case 'jump': {
      const id = checkId(op.id)
      need(list, id)
      const parked = list.map(n => (n.state === 'active' && n.id !== id ? { ...n, isParked: true } : n))

      return activate(parked, id, now)
    }
    case 'status': {
      const id = checkId(op.id)
      need(list, id)
      if (!STATES.includes(op.state)) throw new Error(`unknown state ${JSON.stringify(op.state)}`)
      const titled = op.title ? list.map(n => (n.id === id ? { ...n, title: op.title ?? n.title } : n)) : list
      if (op.state === 'active') return activate(titled, id, now)
      if (op.state === 'done') return finish(titled, id, now)

      return titled.map(n => (n.id === id ? withState(n, op.state, now) : n))
    }
    case 'complete': {
      // The user closing a side entry by hand: it and its open children are done,
      // and the focus stays where it is, so the active entry and its parents refuse.
      const id = checkId(op.id)
      need(list, id)
      const active = list.find(n => n.state === 'active')
      if (active && (active.id === id || isAncestor(id, active.id))) {
        throw new Error(`${id} is active or above the active entry; finish it in the conversation`)
      }

      return list.map(n => (n.id === id || isAncestor(id, n.id) ? withState(n, 'done', now) : n))
    }
    case 'remove': {
      const id = checkId(op.id)

      return list.filter(n => n.id !== id && !isAncestor(id, n.id))
    }
    case 'reset':
      return []
  }
}

/** One column of a row's prefix and the tree depth whose line it draws. */
export type Guide = { text: string; depth: number }

export type Row = { node: StackNode; depth: number; prefix: string; guides: Guide[]; isOnPath: boolean }

/** How many entries under `id` are still open: what completing it would also close. */
export function openBelow(nodes: readonly StackNode[], id: string): number {
  return nodes.filter(n => isAncestor(id, n.id) && n.state !== 'done').length
}

/** The ids from the root down to the active node; empty when nothing is active. */
export function pathToActive(nodes: readonly StackNode[]): string[] {
  const active = nodes.find(n => n.state === 'active')
  if (!active) return []

  return nodes
    .filter(n => n.id === active.id || isAncestor(n.id, active.id))
    .map(n => n.id)
    .sort(compareIds)
}

/** The tree in drawing order, each row with its box-drawing prefix. */
export function buildRows(nodes: readonly StackNode[]): Row[] {
  const sorted = [...nodes].sort((a, b) => compareIds(a.id, b.id))
  const parentOf = new Map<string, string | undefined>()
  for (const n of sorted) {
    const parent = sorted.filter(p => isAncestor(p.id, n.id)).sort((a, b) => b.id.length - a.id.length)[0]
    parentOf.set(n.id, parent?.id)
  }
  const children = (id: string | undefined) => sorted.filter(n => parentOf.get(n.id) === id)
  const onPath = new Set(pathToActive(nodes))
  const rows: Row[] = []

  const walk = (id: string | undefined, depth: number, carry: Guide[]) => {
    const kids = children(id)
    kids.forEach((node, i) => {
      const isLast = i === kids.length - 1
      const guides = depth === 0 ? [] : [...carry, { text: isLast ? '└─ ' : '├─ ', depth }]
      const prefix = guides.map(g => g.text).join('')
      rows.push({ node, depth, prefix, guides, isOnPath: onPath.has(node.id) })
      walk(node.id, depth + 1, depth === 0 ? [] : [...carry, { text: isLast ? '   ' : '│  ', depth }])
    })
  }
  walk(undefined, 0, [])

  return rows
}

/** The state's mark at `now`: spinning, pulsing or settling while motion is on. */
export function glyph(state: StackState, now: number, changedAt: number, isMoving: boolean): string {
  if (!isMoving) return STILL[state]
  switch (state) {
    case 'active':
      return SPIN[Math.floor(now / SPIN_MS) % SPIN.length] ?? STILL.active
    case 'followup':
      return PULSE[Math.floor(now / PULSE_MS) % PULSE.length] ?? STILL.followup
    case 'done':
      return SETTLE[Math.floor((now - changedAt) / SETTLE_MS)] ?? STILL.done
    default:
      return STILL[state]
  }
}

/** Blocked blinks: bold on the even beat, dim on the odd. */
export function isBlinkOn(now: number, isMoving: boolean): boolean {
  return !isMoving || Math.floor(now / BLINK_MS) % 2 === 0
}

/** A node pushed in the last FLASH_MS draws inverted once. */
export function isFlashing(node: StackNode, now: number, isMoving: boolean): boolean {
  return isMoving && node.state === 'active' && now - node.createdAt < FLASH_MS
}

/** Whether anything on screen still moves, so the frame timer can stop when idle. */
export function isAnimating(nodes: readonly StackNode[], now: number, isMoving: boolean): boolean {
  return (
    isMoving &&
    nodes.some(n => n.state === 'active' || n.state === 'followup' || n.state === 'blocked' || now - n.changedAt < FLASH_MS)
  )
}

/** The tree as plain text, for the model's tool result. */
export function renderText(nodes: readonly StackNode[]): string {
  if (nodes.length === 0) return '(stack empty)'

  return buildRows(nodes)
    .map(r => `${r.prefix}${STILL[r.node.state]} ${r.node.id}  ${r.node.title}  [${r.node.isParked ? 'paused' : LABEL[r.node.state]}]`)
    .join('\n')
}
