import { describe, expect, mock, test } from 'claude-code/testing'

import { COLOR, applyOp, buildRows, depthColor, glyph, pathToActive, renderText } from '../hooks/stack'
import type { StackNode } from '../types'
import { addTurn, bar, levelColor, rollup, shortTokens } from '../hooks/usage'

const TOOL = 'mcp__trailback__stack'
const CWD = '/work/project'

function states(nodes: readonly StackNode[]) {
  return Object.fromEntries(nodes.map(n => [n.id, n.state]))
}

describe('applyOp', () => {
  test('push nests: the new node is active, its ancestors suspended', () => {
    let nodes: StackNode[] = []
    nodes = applyOp(nodes, { op: 'push', id: '1', title: 'tiers' }, 0)
    nodes = applyOp(nodes, { op: 'push', id: '1.1', title: 'probe' }, 1)
    nodes = applyOp(nodes, { op: 'push', id: '1.1.1', title: 'why' }, 2)

    expect(states(nodes)).toEqual({ '1': 'suspended', '1.1': 'suspended', '1.1.1': 'active' })
    expect(pathToActive(nodes)).toEqual(['1', '1.1', '1.1.1'])
  })

  test('pop marks the top done and reactivates its nearest open ancestor (LIFO)', () => {
    let nodes: StackNode[] = []
    nodes = applyOp(nodes, { op: 'push', id: '1', title: 'a' }, 0)
    nodes = applyOp(nodes, { op: 'push', id: '1.3', title: 'b' }, 1)
    nodes = applyOp(nodes, { op: 'push', id: '1.3.1', title: 'c' }, 2)
    nodes = applyOp(nodes, { op: 'pop' }, 3)

    expect(states(nodes)).toEqual({ '1': 'suspended', '1.3': 'active', '1.3.1': 'done' })
  })

  test('only one node is active: focusing a sibling parks the old one as pending', () => {
    let nodes: StackNode[] = []
    nodes = applyOp(nodes, { op: 'push', id: '1', title: 'a' }, 0)
    nodes = applyOp(nodes, { op: 'push', id: '1.1', title: 'b' }, 1)
    nodes = applyOp(nodes, { op: 'push', id: '1.2', title: 'c' }, 2)

    expect(states(nodes)).toEqual({ '1': 'suspended', '1.1': 'pending', '1.2': 'active' })
  })

  test('status sets follow-up and blocked without moving the active node', () => {
    let nodes: StackNode[] = []
    nodes = applyOp(nodes, { op: 'push', id: '1', title: 'a' }, 0)
    nodes = applyOp(nodes, { op: 'add', id: '1.2', title: 'b', state: 'followup' }, 1)
    nodes = applyOp(nodes, { op: 'add', id: '1.3', title: 'c', state: 'blocked' }, 2)

    expect(states(nodes)).toEqual({ '1': 'active', '1.2': 'followup', '1.3': 'blocked' })
  })

  test('rejects a malformed id', () => {
    expect(() => applyOp([], { op: 'push', id: '1..2', title: 'x' }, 0)).toThrow('id')
  })
})

describe('buildRows', () => {
  test('draws connectors in numeric order (1.10 after 1.2)', () => {
    let nodes: StackNode[] = []
    for (const id of ['1', '1.10', '1.2', '1.2.1']) {
      nodes = applyOp(nodes, { op: 'add', id, title: id, state: 'pending' }, 0)
    }
    const rows = buildRows(nodes).map(r => `${r.prefix}${r.node.id}`)

    expect(rows).toEqual(['1', '├─ 1.2', '│  └─ 1.2.1', '└─ 1.10'])
  })
})

describe('glyph', () => {
  test('active spins, follow-up pulses, done is still', () => {
    expect(glyph('active', 0, 0, true)).toBe('⠋')
    expect(glyph('active', 100, 0, true)).toBe('⠙')
    expect(glyph('followup', 0, 0, true)).not.toBe(glyph('followup', 180, 0, true))
    expect(glyph('done', 5000, 0, true)).toBe('✓')
  })

  test('motion off freezes every glyph', () => {
    expect(glyph('active', 600, 0, false)).toBe('▶')
  })
})

test('the model drives the stack through the tool', async ($, on) => {
    on('session.cwd', () => ({ value: CWD }))
  mock.clock(on, { now: 1_000 })
  await $.tool.call({ tool: TOOL, op: 'push', id: '1', title: 'root' })
  const ran = await $.tool.call({ tool: TOOL, op: 'push', id: '1.1', title: 'child' })

  expect(ran.deny).toBeUndefined()
  expect(String(ran.result)).toBe('◐ 1  root  [suspended]\n└─ ▶ 1.1  child  [active]')
})

test('a bad op is refused back to the model, the stack untouched', async ($, on) => {
    on('session.cwd', () => ({ value: CWD }))
  mock.clock(on, { now: 1_000 })
  const ran = await $.tool.call({ tool: TOOL, op: 'pop' })

  expect(ran.deny ?? ran.text ?? '').toContain('nothing to pop')
  const after = await $.tool.call({ tool: TOOL, op: 'add', id: '1', title: 'only' })
  expect(String(after.result)).toBe('○ 1  only  [pending]')
})

describe('rich colors', () => {
  test('each depth has its own hue, cycling after four levels', () => {
    expect([0, 1, 2, 3, 4].map(depthColor)).toEqual(['planMode', 'autoAccept', 'bashBorder', 'warning', 'planMode'])
  })

  test('guide columns carry the depth they belong to', () => {
    let nodes: StackNode[] = []
    for (const id of ['1', '1.1', '1.1.1', '1.2']) {
      nodes = applyOp(nodes, { op: 'add', id, title: id, state: 'pending' }, 0)
    }
    const deep = buildRows(nodes).find(r => r.node.id === '1.1.1')

    expect(deep?.guides).toEqual([
      { text: '│  ', depth: 1 },
      { text: '└─ ', depth: 2 },
    ])
  })

  test('suspended reads apart from active', () => {
    expect(COLOR.suspended).not.toBe(COLOR.active)
  })
})

test('status can retitle an entry', () => {
  let nodes: StackNode[] = []
  nodes = applyOp(nodes, { op: 'push', id: '1', title: 'old' }, 0)
  nodes = applyOp(nodes, { op: 'status', id: '1', state: 'followup', title: 'new' }, 1)

  expect(nodes[0]?.title).toBe('new')
})

for (const surface of ['terminal', 'desktop'] as const) {
  for (const palette of ['rich', 'calm'] as const) {
    test(`the pane draws a valid tree on ${surface} (${palette})`, async ($, on) => {
    on('session.cwd', () => ({ value: CWD }))
      mock.clock(on, { now: 5_000 })
      await $.tool.call({
        tool: TOOL,
        ops: [
          { op: 'push', id: '0', title: 'root' },
          { op: 'add', id: '0.1', title: 'done one', state: 'done' },
          { op: 'push', id: '0.2', title: 'active one' },
          { op: 'add', id: '0.2.1', title: 'waiting', state: 'followup' },
          { op: 'add', id: '0.3', title: 'stuck', state: 'blocked' },
        ],
      })
      await $.command.run({
        command: 'trail',
        args: `color ${palette}`,
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 160 },
      })

      await expect(
        $.ui.mount({ plugin: 'trailback', surface, component: 'Pane', props: {} as never, requestId: 'trailback' }),
      ).resolves.toBeDefined()
    })
  }
}

describe('jump from the pane', () => {
  function seeded(): StackNode[] {
    let nodes: StackNode[] = []
    nodes = applyOp(nodes, { op: 'push', id: '0', title: 'root' }, 0)
    nodes = applyOp(nodes, { op: 'push', id: '0.1', title: 'current' }, 1)
    nodes = applyOp(nodes, { op: 'add', id: '0.2', title: 'later' }, 2)

    return nodes
  }

  test('the picked entry turns active and the old one is paused, not reset', () => {
    const nodes = applyOp(seeded(), { op: 'jump', id: '0.2' }, 3)

    expect(states(nodes)).toEqual({ '0': 'suspended', '0.1': 'suspended', '0.2': 'active' })
    expect(nodes.find(n => n.id === '0.1')?.isParked).toBe(true)
    expect(renderText(nodes)).toContain('0.1  current  [paused]')
  })

  test('a paused entry stays paused while the jumped-to one finishes', () => {
    let nodes = applyOp(seeded(), { op: 'jump', id: '0.2' }, 3)
    nodes = applyOp(nodes, { op: 'pop' }, 4)

    expect(states(nodes)).toEqual({ '0': 'active', '0.1': 'suspended', '0.2': 'done' })
  })

  test('returning to a paused entry clears its pause', () => {
    let nodes = applyOp(seeded(), { op: 'jump', id: '0.2' }, 3)
    nodes = applyOp(nodes, { op: 'focus', id: '0.1' }, 4)

    expect(nodes.find(n => n.id === '0.1')?.isParked).toBeUndefined()
    expect(nodes.find(n => n.id === '0.1')?.state).toBe('active')
  })
})

test('active reads green and paused reads orange', () => {
  expect(COLOR.active).toBe('success')
  expect(COLOR.suspended).toBe('claude')
})

describe('the Arjun persona', () => {
  test('rides the system prompt while on and leaves it when switched off', async ($, on) => {
    on('session.cwd', () => ({ value: CWD }))
    on('prompt.compose', () => ({ sections: [] }))
    const ids = async () =>
      (await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })).sections.map(
        s => s.id,
      )

    expect(await ids()).toEqual(['trailback:protocol', 'trailback:arjun'])
    await $.command.run({
      command: 'trail',
      args: 'arjun off',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 160 },
    })
    expect(await ids()).toEqual(['trailback:protocol', 'trailback:one-shot'])
  })
})

describe('the next prompt', () => {
  test('carries the jump picked in the pane, hidden from the user', async ($, on) => {
    on('session.cwd', () => ({ value: CWD }))
    mock.clock(on, { now: 1_000 })
    let seen: readonly string[] = []
    on('prompt.submit', (_$, e) => {
      seen = e.context ?? []

      return { text: e.text, context: e.context }
    })
    await $.tool.call({
      tool: TOOL,
      ops: [
        { op: 'push', id: '0', title: 'root' },
        { op: 'push', id: '0.1', title: 'current' },
        { op: 'add', id: '0.2', title: 'later' },
      ],
    })
    await $.ui.mount({ plugin: 'trailback', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'trailback' })
    await $.ui.press({ plugin: 'trailback', key: 'pick:0.2' })
    await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })

    expect(seen.join('\n')).toContain('focus moved to 0.2 "later"; 0.1 "current" is paused')
    const after = await $.tool.call({ tool: TOOL, op: 'add', id: '0.3', title: 'x' })
    expect(String(after.result)).toContain('▶ 0.2  later  [active]')
  })

  test('carries a reminder when the last turn left the stack untouched', async ($, on) => {
    on('session.cwd', () => ({ value: CWD }))
    mock.clock(on, { now: 1_000 })
    let seen: readonly string[] = []
    on('prompt.submit', (_$, e) => {
      seen = e.context ?? []

      return { text: e.text, context: e.context }
    })
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await $.tool.call({ tool: TOOL, op: 'push', id: '0', title: 'root' })
    await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 't1' } as never)
    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    await $.turn.complete({ answer: 'b', durationMs: 1, isAborted: false, turnId: 't2' } as never)
    await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'composer' } })

    expect(seen.join('\n')).toContain('stack was not updated')
  })
})

describe('across sessions', () => {
  test('each change saves the stack under the project folder', async ($, on) => {
    on('session.cwd', () => ({ value: CWD }))
    mock.clock(on, { now: 1_000 })
    const writes: Record<string, unknown> = {}
    on('store.get', () => ({ value: undefined }))
    on('store.set', (_$, e) => {
      writes[e.key] = e.value

      return { value: undefined }
    })
    await $.tool.call({ tool: TOOL, op: 'push', id: '7', title: 'kept' })

    const saved = writes[`stack:${CWD}`] as { nodes: StackNode[] } | undefined
    expect(saved?.nodes.map(n => n.id)).toEqual(['7'])
  })

  test('a new session in the same folder resumes the saved stack and choices', async ($, on) => {
    on('session.cwd', () => ({ value: CWD }))
    mock.clock(on, { now: 1_000 })
    mock.store(on, {
      [`stack:${CWD}`]: { nodes: [{ id: '4', title: 'from yesterday', state: 'active', createdAt: 1, changedAt: 1 }] },
      prefs: { isArjunOn: false, palette: 'rich', motion: true },
    })
    on('prompt.compose', () => ({ sections: [] }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('tool.register', () => ({ value: { tool: TOOL } }))
    on('command.register', () => ({ value: { command: 'trail' } }))
    await $.session.start({ cwd: CWD, surface: null, isInteractive: true })
    const ran = await $.tool.call({ tool: TOOL, op: 'add', id: '4.1', title: 'today' })

    expect(String(ran.result)).toContain('▶ 4  from yesterday  [active]')
    const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
    expect(composed.sections.map(x => x.id)).toContain('trailback:one-shot')
  })
})

describe('usage', () => {
  test('quota bars fill by percent and colour by level', () => {
    expect(bar(62, 8)).toBe('▓▓▓▓▓░░░')
    expect([levelColor(42), levelColor(65), levelColor(85)]).toEqual(['success', 'warning', 'error'])
  })

  test('turns and output tokens land on the active entry and roll up to its parents', () => {
    let nodes: StackNode[] = []
    nodes = applyOp(nodes, { op: 'push', id: '1', title: 'a' }, 0)
    nodes = addTurn(nodes, 1500)
    nodes = applyOp(nodes, { op: 'push', id: '1.1', title: 'b' }, 1)
    nodes = addTurn(nodes, 2600)
    nodes = addTurn(nodes, 400)

    expect(rollup(nodes, '1.1')).toEqual({ turns: 2, outTokens: 3000 })
    expect(rollup(nodes, '1')).toEqual({ turns: 3, outTokens: 4500 })
    expect(shortTokens(4500)).toBe('4.5k')
  })
})

test('Go sends a prompt for the picked entry that asks for a brief and the open actions', async ($, on) => {
  on('session.cwd', () => ({ value: CWD }))
  mock.clock(on, { now: 1_000 })
  let sent = ''
  let seen: readonly string[] = []
  on('prompt.submit', (_$, e) => {
    sent = e.text
    seen = e.context ?? []

    return { text: e.text, context: e.context }
  })
  await $.tool.call({
    tool: TOOL,
    ops: [
      { op: 'push', id: '0', title: 'root' },
      { op: 'push', id: '0.1', title: 'current' },
      { op: 'add', id: '0.2', title: 'later' },
    ],
  })
  await $.ui.mount({ plugin: 'trailback', surface: 'terminal', component: 'Pane', props: {} as never, requestId: 'trailback' })
  await $.ui.press({ plugin: 'trailback', key: 'pick:0.2' })
  await $.ui.press({ plugin: 'trailback', key: 'go' })

  expect(sent).toContain('Resume 0.2 "later"')
  expect(sent).toContain('1 to 3 lines')
  expect(sent).toContain('action items')
  void seen
  const tree = await $.tool.call({ tool: TOOL, op: 'add', id: '0.3', title: 'x' })
  expect(String(tree.result)).toContain('▶ 0.2  later  [active]')
  expect(String(tree.result)).toContain('0.1  current  [paused]')
})

test('finishing a paused entry drops the pause', () => {
  let nodes: StackNode[] = []
  nodes = applyOp(nodes, { op: 'push', id: '0', title: 'root' }, 0)
  nodes = applyOp(nodes, { op: 'push', id: '0.1', title: 'a' }, 1)
  nodes = applyOp(nodes, { op: 'add', id: '0.2', title: 'b' }, 2)
  nodes = applyOp(nodes, { op: 'jump', id: '0.2' }, 3)
  nodes = applyOp(nodes, { op: 'status', id: '0.1', state: 'done' }, 4)

  expect(nodes.find(n => n.id === '0.1')?.isParked).toBeUndefined()
  expect(renderText(nodes)).toContain('0.1  a  [done]')
})
