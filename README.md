<p align="center"><img src="assets/logo.svg" width="128" alt="TrailBack logo: black footprints on white"></p>

# TrailBack

A Claude Code mod that draws your conversation's context stack as a live tree, so a session that
wanders into side questions always shows the way back.

```
 [ Arjun Mode ]  ● on · step by step  ⓘ                3/7 ✓

 5h ▓▓▓▓▓░░░ 62%   7d ▓▓░░░░░░ 21%   ctx 48%
 ──────────────────────────────────────────────────────────
  ◐ 0  build stack-tree mod
› ├─ ✓ 0.1  visual spec
  ├─ ◐ 0.3  ScreenCut release                        PAUSED
› │  └─ ○ 0.3.2  README review
  └─ ◐ 0.8  publish TrailBack
     ├─ ⠹ 0.8.2  implement · 3 turns · 4.1k out      ACTIVE
›    ├─ ◎ 0.8.3  confirm repo name                FOLLOW-UP
›    └─ ✕ 0.8.4  token scope                        BLOCKED

                                                   h: help
```

Claude keeps the stack up to date itself, through a `stack` tool the mod gives it: a new step or a
nested question is pushed, a resolved one is popped and focus returns to its parent.

## Install

In a Claude Code terminal session:

```
/plugin install trailback --marketplace captPython/trailback
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). Then open
the pane:

```
/trail
```

The pane is placed beside the conversation; on a narrow terminal it waits until there is room.

## States

| Mark | State | Colour | Meaning |
|---|---|---|---|
| `⠋⠙⠹…` | Active | green, spins; badge blinks | What Claude is working on now |
| `◐` | Suspended | orange | Waiting for its children to finish, or paused by you (`PAUSED`) |
| `◌○◎●` | Follow-up | blue, pulses | Claude handed you a step and waits for your answer |
| `✕` | Blocked | red, blinks | Waiting on a permission, a decision or an error |
| `○` | Pending | grey | Planned, not started |
| `✓` | Done | dim, struck through | Resolved |

The tree's guide lines take a colour per depth, and the path down to the active entry is drawn in green.
Colours come from your Claude Code theme, so they follow light and dark themes.

## Pick what to work on next

Every open entry has a `›` in the left margin. Press it (click it, or focus the pane with `ctrl+x tab`
and press Enter on it) and it turns into `➜`, with its buttons on the right, while the current entry
shows `→ PAUSE`. Press it again to cancel.

Then either:

- press **[ Go ➜ ]** on that row (or `g`): the picked entry becomes active, the old one
  is paused (orange, `PAUSED`) rather than dropped, and TrailBack sends a prompt asking Claude to catch
  you up in 1 to 3 lines and list the action items you still owe on it before carrying on; or
- press **[ ✓ Done ]** (or `d`) to close it yourself, with any open entries under it; the button counts
  them (`✓ Done +2`). The focus stays where it is, and Claude is told on your next prompt. The active
  entry and the entries above it have no Done button: those finish in the conversation; or
- just type your next prompt: the same switch as Go happens before Claude reads it, and Claude is told.

## Arjun Mode: one step at a time

TrailBack ships with Arjun Mode, a working style for long technical sessions:

- one actionable step per reply, then wait for you
- nested questions handled last-in, first-out, with the active level named in each reply
- targeted questions instead of guesses when something is ambiguous
- a short Verification & Confidence block at the end of every reply

Arjun Mode is on when you install. The **[ Arjun Mode ]** button at the top of the pane (or `a` while the
pane has focus) switches it off and on at any time, from the next reply on; `ⓘ` shows a three-line
summary of what it does. Off, Claude answers each request in
full in one go; the tree keeps working either way. Your choice is remembered across sessions.

## Usage and quota

The second line shows your 5-hour and weekly windows as bars and how full the context window is, the
same figures as Claude Code's status line. Each turns amber from 50% and red from 80%; a toast warns
once when a window passes 90%. A rule as wide as the pane separates the header from the tree. The
windows appear on a Claude subscription once the first reply has reported them.

The active entry shows the turns spent on it and their output tokens, its children included.
`/trail usage on` shows that on every row.

## Legend and keys

`help` at the bottom right (or `h`) shows the marks and the pane's keys; press it again to hide them.

## Across sessions

The stack is saved per project folder. A new or resumed session in the same folder picks up the trail
where it was; `/trail reset` clears it for that folder.

## Commands

| Command | Does |
|---|---|
| `/trail` | Open the pane |
| `/trail arjun on` / `off` | Switch Arjun without the pane |
| `/trail usage on` / `off` | Turns and output tokens on every row, or on the active one only |
| `/trail color rich` / `calm` | Depth colours and badges, or a quieter look |
| `/trail motion on` / `off` | Spinners and blinking, or still marks |
| `/trail reset` | Clear the stack for this project |
| `/trail close` | Close the pane |

## How it works, and its limits

The mod adds two short sections to Claude's system prompt: how to keep the stack, and either the Arjun
rules or a note to answer in one go. Claude updates the tree by calling the `stack` tool, which
answers with the tree as text, so Claude and the pane read the same state.

The tree is only as current as those calls. When a turn ends with the stack untouched, TrailBack shows
a toast and reminds Claude at the start of your next prompt. Each update is a small tool call, which
adds a little time and a few tokens to a turn.

## Development

```bash
claude plugin validate .
claude plugin test .
```

To run a working copy instead of the installed one, start Claude Code with `claude --plugin-dir <this folder>`.

## License

MIT
