/** `rich`: depth colors, badges and chips; `calm`: the quieter look. */
export type StackPalette = 'rich' | 'calm'

/** Where one stack entry stands. */
export type StackState = 'active' | 'followup' | 'blocked' | 'suspended' | 'pending' | 'done'

/** One entry of the context stack; `id` is dotted (`1.3.1`), its depth the tree's. */
export type StackNode = {
  id: string
  title: string
  state: StackState
  createdAt: number
  changedAt: number
  /** Set aside by a jump from the pane; cleared when it is active again. */
  isParked?: boolean
  /** Turns that ended while this entry was active, and their output tokens. */
  turns?: number
  outTokens?: number
}

/**
 * Go, waiting for its own turn to start: the entry to switch to, the prompt it sent,
 * and the closes and reminder that prompt carries, to be marked as told then.
 */
export type GoRequest = { id: string; text: string; doneIds: string[]; isCarryingReminder: boolean }

/** An entry the user closed with Done, and how many open entries closed with it. */
export type PendingDone = { id: string; title: string; closing: number }

/** One rate-limit window as the last response reported it. */
export type QuotaWindow = { kind: string; percentUsed: number; resetsAt?: string }

/** The figures the pane's top line shows; each absent where the engine has none. */
export type UsageSnapshot = { windows: QuotaWindow[]; contextPercent?: number; costUsd?: number }

declare module 'claude-code' {
  interface PluginState {
    trailback: {
      nodes: StackNode[]
      motion: boolean
      palette: StackPalette
      isArjunOn: boolean
      /** The entry picked in the pane for the next prompt; '' for none. */
      nextId: string
      /** Whether the stack tool ran during the current turn. */
      isTouched: boolean
      /** Whether the next prompt carries a reminder to update the stack. */
      isReminderDue: boolean
      /** Entries the user closed in the pane that Claude has not been told about yet. */
      pendingDone: PendingDone[]
      /** Go's switch, applied when the turn its prompt starts begins; null when none waits. */
      goRequest: GoRequest | null
      /** Whether the pane shows the three-line explainer of Arjun Mode, and the legend and keys. */
      isInfoShown: boolean
      isHelpShown: boolean
      /** Whether every row shows its turns and output tokens, not only the active one. */
      isUsageShown: boolean
      usage: UsageSnapshot
    }
  }
}
