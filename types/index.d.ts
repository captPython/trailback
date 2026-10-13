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
}

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
    }
  }
}
