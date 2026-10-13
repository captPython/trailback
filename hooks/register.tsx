import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { StackNode, StackPalette, StackState } from '../types'
import { ARJUN, ONE_SHOT, PROTOCOL, REMINDER, jumpNote } from './persona'
import {
  BADGE,
  COLOR,
  LABEL,
  STATES,
  STILL,
  applyOp,
  buildRows,
  depthColor,
  glyph,
  isAnimating,
  isBlinkOn,
  isFlashing,
  pathToActive,
  renderText,
} from './stack'
import type { StackOp } from './stack'

const PLUGIN = 'trailback'
const PANE = 'trailback'
const TITLE = 'TrailBack'
const FRAME_MS = 100
const PREFS = 'prefs'

const nodesAtom = atom({ plugin: 'trailback', key: 'nodes' } as const, [] as StackNode[])
const motionAtom = atom({ plugin: 'trailback', key: 'motion' } as const, true)
const paletteAtom = atom({ plugin: 'trailback', key: 'palette' } as const, 'rich' as StackPalette)
const arjunAtom = atom({ plugin: 'trailback', key: 'isArjunOn' } as const, true)
const nextAtom = atom({ plugin: 'trailback', key: 'nextId' } as const, '')
const touchedAtom = atom({ plugin: 'trailback', key: 'isTouched' } as const, false)
const reminderAtom = atom({ plugin: 'trailback', key: 'isReminderDue' } as const, false)

const OPS = ['push', 'add', 'pop', 'status', 'focus', 'jump', 'remove', 'reset']

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: OPS },
    id: { type: 'string', description: 'Dotted stack id, e.g. 1.3.1' },
    title: { type: 'string', description: 'Short label for the entry' },
    state: { type: 'string', enum: STATES },
    ops: {
      type: 'array',
      description: 'Several operations applied in order, instead of op/id/title/state',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: OPS },
          id: { type: 'string' },
          title: { type: 'string' },
          state: { type: 'string', enum: STATES },
        },
        required: ['op'],
      },
    },
  },
}

type Prefs = { isArjunOn?: boolean; palette?: StackPalette; motion?: boolean }

function toOps(input: Record<string, unknown>): StackOp[] {
  const raw: unknown[] = Array.isArray(input.ops) ? input.ops : [input]

  return raw.map(one => {
    const o = (one ?? {}) as Record<string, unknown>
    if (typeof o.op !== 'string' || !OPS.includes(o.op)) throw new Error(`unknown op ${JSON.stringify(o.op)}`)

    return { op: o.op, id: o.id, title: typeof o.title === 'string' ? o.title : '', state: o.state } as StackOp
  })
}

function statusText(nodes: readonly StackNode[], isArjunOn: boolean): string | undefined {
  const mode = isArjunOn ? 'Arjun on' : 'one-shot'
  const active = nodes.find(n => n.state === 'active')
  if (!active) return nodes.length === 0 ? undefined : `trail · idle · ${mode}`
  const title = active.title.length > 32 ? `${active.title.slice(0, 31)}…` : active.title

  return `trail ${pathToActive(nodes).join(' › ')} · ${title} · ${mode}`
}

// Module variables start over on a reload; session.start runs again then.
let ticker: Timer | undefined

/** One animation frame: redraw, and stop the timer once nothing moves. */
async function tick($: EngineInterface) {
  const [nodes, motion, now] = await Promise.all([read($, nodesAtom), read($, motionAtom), $.clock.now()])
  $.ui.invalidate('ui.render')
  if (!isAnimating(nodes, now, motion)) {
    ticker?.cancel()
    ticker = undefined
  }
}

/** The stack is kept per project folder, so a later session there resumes it; undefined when unknown. */
async function stackKey($: EngineInterface): Promise<string | undefined> {
  const cwd = await $.session.cwd().catch(() => undefined)

  return cwd ? `stack:${cwd}` : undefined
}

async function saveStack($: EngineInterface) {
  const key = await stackKey($)
  if (key) await $.store.set(key, { nodes: await read($, nodesAtom) }).catch(() => undefined)
}

async function savePrefs($: EngineInterface) {
  const [isArjunOn, palette, motion] = await Promise.all([read($, arjunAtom), read($, paletteAtom), read($, motionAtom)])
  await $.store.set(PREFS, { isArjunOn, palette, motion }).catch(() => undefined)
}

/** At session start: the saved stack (unless this session already holds one) and the saved choices. */
async function restore($: EngineInterface) {
  const prefs = ((await $.store.get(PREFS).catch(() => undefined)) ?? {}) as Prefs
  if (typeof prefs.isArjunOn === 'boolean') await update($, arjunAtom, () => prefs.isArjunOn ?? true)
  if (prefs.palette === 'rich' || prefs.palette === 'calm') await update($, paletteAtom, () => prefs.palette ?? 'rich')
  if (typeof prefs.motion === 'boolean') await update($, motionAtom, () => prefs.motion ?? true)
  const key = await stackKey($)
  const saved = (key ? await $.store.get(key).catch(() => undefined) : undefined) as { nodes?: StackNode[] } | undefined
  if (Array.isArray(saved?.nodes) && saved.nodes.length > 0) {
    await update($, nodesAtom, list => (list.length > 0 ? list : saved.nodes ?? []))
  }
}

/** After any change: save, status line, redraw, and the frame timer if it is idle. */
async function refresh($: EngineInterface) {
  const [nodes, isArjunOn] = await Promise.all([read($, nodesAtom), read($, arjunAtom)])
  $.ui.status(statusText(nodes, isArjunOn))
  $.ui.invalidate('ui.render')
  if (!ticker) ticker = $.clock.every(FRAME_MS, () => void tick($))
  await saveStack($)
}

async function setArjun($: EngineInterface, isOn: boolean) {
  await update($, arjunAtom, () => isOn)
  await savePrefs($)
  await refresh($)
}

async function toggleArjun($: EngineInterface) {
  await setArjun($, !(await read($, arjunAtom)))
}

async function pick($: EngineInterface, id: string) {
  await update($, nextAtom, current => (current === id ? '' : id))
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Restore first: the trail comes back even if a registration below fails.
    await restore($)
    await refresh($)
    await $.tool.register({
      name: 'stack',
      description:
        'Update the TrailBack context stack shown to the user as a live tree. ' +
        'push/add/pop/status/focus/jump/remove/reset; ids are dotted (1.3.1). Returns the tree as text.',
      inputSchema: TOOL_SCHEMA,
    })
    await $.command.register({
      name: 'trail',
      description: 'Show the TrailBack stack tree (args: arjun on|off, color rich|calm, motion on|off, reset, close)',
    })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const isArjunOn = await read($, arjunAtom)
    const mode = isArjunOn
      ? { id: `${PLUGIN}:arjun`, text: ARJUN, scope: 'session' as const }
      : { id: `${PLUGIN}:one-shot`, text: ONE_SHOT, scope: 'session' as const }

    return {
      sections: [...composed.sections, { id: `${PLUGIN}:protocol`, text: PROTOCOL, scope: 'session' as const }, mode],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const notes: string[] = []
    await update($, touchedAtom, () => false)

    const nextId = await read($, nextAtom)
    if (nextId) {
      const nodes = await read($, nodesAtom)
      const to = nodes.find(n => n.id === nextId)
      const from = nodes.find(n => n.state === 'active')
      if (to && to.state !== 'done' && to.state !== 'active') {
        const now = await $.clock.now()
        await update($, nodesAtom, list => applyOp(list, { op: 'jump', id: to.id }, now))
        notes.push(jumpNote(to, from))
      }
      await update($, nextAtom, () => '')
      await refresh($)
    }
    if (await read($, reminderAtom)) {
      notes.push(REMINDER)
      await update($, reminderAtom, () => false)
    }

    return next(notes.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...notes] })
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && !e.isAborted) {
      const [nodes, isTouched] = await Promise.all([read($, nodesAtom), read($, touchedAtom)])
      if (nodes.length > 0 && !isTouched) {
        await update($, reminderAtom, () => true)
        $.ui.toast('TrailBack: stack not updated this turn')
      }
    }

    return done
  })

  on('tool.call', { tool: 'mcp__trailback__stack' }, async ($, e) => {
    const now = await $.clock.now().catch(() => Date.now())
    let failure: string | undefined
    await update($, nodesAtom, list => {
      failure = undefined
      try {
        return toOps(e as unknown as Record<string, unknown>).reduce((acc, op) => applyOp(acc, op, now), list)
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err)

        return list
      }
    })
    if (failure) return { deny: failure }
    await update($, touchedAtom, () => true)
    await refresh($).catch(() => undefined)

    return { result: renderText(await read($, nodesAtom)) }
  }).catch(() => ({ deny: 'trailback: the stack could not be updated; carry on and retry later' }))

  on('command.run', { command: 'trail' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'arjun on' || arg === 'arjun off') {
      await setArjun($, arg === 'arjun on')

      return { text: `Arjun ${arg === 'arjun on' ? 'on: one step at a time' : 'off: complete answers in one go'}.` }
    }
    if (arg === 'motion off' || arg === 'motion on') {
      await update($, motionAtom, () => arg === 'motion on')
      await savePrefs($)
      await refresh($)

      return { text: `TrailBack motion ${arg === 'motion on' ? 'on' : 'off'}.` }
    }
    if (arg === 'color rich' || arg === 'color calm') {
      const palette: StackPalette = arg === 'color rich' ? 'rich' : 'calm'
      await update($, paletteAtom, () => palette)
      await savePrefs($)
      await refresh($)

      return { text: `TrailBack colors ${palette}.` }
    }
    if (arg === 'reset') {
      await update($, nodesAtom, () => [])
      await update($, nextAtom, () => '')
      await refresh($)

      return { text: 'TrailBack stack cleared for this project.' }
    }
    if (arg === 'close') {
      await $.ui.close({ id: PANE })

      return { text: 'TrailBack pane closed.' }
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)

    return { text: opened.isPlaced ? 'TrailBack pane opened.' : 'TrailBack pane waits for a wider terminal.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [nodes, motion, palette, isArjunOn, nextId, now] = await Promise.all([
      read($, nodesAtom),
      read($, motionAtom),
      read($, paletteAtom),
      read($, arjunAtom),
      read($, nextAtom),
      $.clock.now(),
    ])
    const isRich = palette === 'rich'
    const blink = isBlinkOn(now, motion)

    const header = (
      <Box flexDirection="row">
        <Button key="arjun" hotkey="a" variant={isArjunOn ? 'primary' : 'secondary'} dimColor={!isArjunOn} onPress={() => toggleArjun($)}>
          Arjun
        </Button>
        <Text color={isArjunOn ? 'success' : 'inactive'} bold={isArjunOn}>
          {isArjunOn ? ' on  ' : ' off '}
        </Text>
        <Text dimColor>{isArjunOn ? 'step by step' : 'one-shot answers'}</Text>
      </Box>
    )

    if (nodes.length === 0) {
      return (
        <Box flexDirection="column">
          {header}
          <Text> </Text>
          <Text dimColor>No trail yet.</Text>
          <Text dimColor>Steps appear here as the conversation nests.</Text>
        </Box>
      )
    }

    const rows = buildRows(nodes)
    const room = Math.max(3, (e.viewport?.rows ?? 24) - 8)
    const at = Math.max(0, rows.findIndex(r => r.node.state === 'active'))
    const start = rows.length <= room ? 0 : Math.min(Math.max(0, at - Math.floor(room / 2)), rows.length - room)
    const shown = rows.slice(start, start + room)
    const counts = STATES.filter(s => s !== 'done' && s !== 'suspended')
      .map(s => [s, nodes.filter(n => n.state === s).length] as const)
      .filter(([, n]) => n > 0)
    const done = nodes.filter(n => n.state === 'done').length
    const isPauseDue = nextId !== '' && nodes.some(n => n.id === nextId && n.state !== 'active' && n.state !== 'done')

    return (
      <Box flexDirection="column">
        {header}
        <Text wrap="truncate-end">
          {counts.map(([s, n]) =>
            isRich ? (
              <Text>
                <Text backgroundColor={COLOR[s]} color="inverseText" bold>
                  {` ${STILL[s]} ${n} `}
                </Text>
                {'  '}
              </Text>
            ) : (
              <Text color={COLOR[s]}>
                {STILL[s]} {n} {LABEL[s]}
                {'   '}
              </Text>
            ),
          )}
          <Text dimColor>
            {' '}
            {done}/{nodes.length} done
          </Text>
        </Text>
        <Text> </Text>
        {start > 0 && <Text dimColor>    ↑ {start} more</Text>}
        {shown.map(({ node, depth, guides, isOnPath }) => {
          const state: StackState = node.state
          const isActive = state === 'active'
          const isBlocked = state === 'blocked'
          const isPicked = node.id === nextId && !isActive
          const isPausing = isActive && isPauseDue
          const isQuiet = state === 'done' || state === 'pending' || (state === 'suspended' && !isRich)
          const isPickable = !isActive && state !== 'done'
          const markColor = isPausing ? 'claude' : isPicked ? 'text' : COLOR[state]
          const pathColor = COLOR.active
          const badge = !isRich
            ? undefined
            : isPausing
              ? { text: '→ PAUSE', color: 'claude', isBlinking: true }
              : isPicked
                ? { text: 'NEXT', color: 'text', isBlinking: false }
                : isActive
                  ? { text: 'ACTIVE', color: COLOR.active, isBlinking: true }
                  : node.isParked && state === 'suspended'
                    ? { text: 'PAUSED', color: COLOR.suspended, isBlinking: false }
                    : BADGE[state]
                      ? { text: BADGE[state] ?? '', color: COLOR[state], isBlinking: isBlocked }
                      : undefined

          return (
            <Box flexDirection="row" justifyContent="space-between">
              <Box flexDirection="row" flexShrink={1}>
                {isPickable ? (
                  <Button key={`pick:${node.id}`} plain dimColor={!isPicked} onPress={() => pick($, node.id)}>
                    {isPicked ? '➜' : '›'}
                  </Button>
                ) : (
                  <Text> </Text>
                )}
                <Text> </Text>
                <Text wrap="truncate-end">
                  {guides.map((g, i) => {
                    const isOwn = i === guides.length - 1

                    return (
                      <Text color={isOwn && isOnPath ? pathColor : isRich ? depthColor(g.depth) : 'subtle'} bold={isOwn && isOnPath}>
                        {g.text}
                      </Text>
                    )
                  })}
                  <Text
                    color={markColor}
                    bold={isActive || isPicked || (isBlocked && blink)}
                    dimColor={(isQuiet && !isPicked) || ((isBlocked || isPausing) && !blink)}
                  >
                    {isPicked ? '➜' : glyph(state, now, node.changedAt, motion)}{' '}
                  </Text>
                  <Text color={isOnPath ? pathColor : isRich ? depthColor(depth) : 'subtle'} bold={isActive || isPicked}>
                    {node.id}
                  </Text>
                  <Text
                    color={isActive || isPicked ? 'text' : isQuiet ? 'inactive' : COLOR[state]}
                    bold={isActive || isPicked}
                    dimColor={state === 'done'}
                    inverse={isFlashing(node, now, motion)}
                  >
                    {'  '}
                    {node.title}
                  </Text>
                </Text>
              </Box>
              {badge && (
                <Box flexShrink={0} marginLeft={1}>
                  <Text
                    backgroundColor={badge.color}
                    color="inverseText"
                    bold
                    dimColor={badge.isBlinking && !blink}
                  >
                    {` ${badge.text} `}
                  </Text>
                </Box>
              )}
            </Box>
          )
        })}
        {start + room < rows.length && <Text dimColor>    ↓ {rows.length - start - room} more</Text>}
        <Text> </Text>
        <Text wrap="truncate-end">
          {STATES.map(s => (
            <Text>
              <Text color={isRich ? COLOR[s] : undefined} dimColor={!isRich}>
                {STILL[s]}
              </Text>
              <Text dimColor> {LABEL[s]}  </Text>
            </Text>
          ))}
          <Text dimColor>
            ➜ next{motion ? '' : ' · motion off'}
            {isRich ? '' : ' · calm'}
          </Text>
        </Text>
        <Text dimColor wrap="truncate-end">
          › pick what to work on next · a toggles Arjun (focus the pane with ctrl+x tab)
        </Text>
      </Box>
    )
  })
}
