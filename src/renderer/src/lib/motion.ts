/** Spring used by the state-block swaps (idle/running/done panels). */
export const spring = { type: 'spring', stiffness: 420, damping: 30 } as const

/** Spring used by project cards (entrance, exit, and grid layout shifts). */
export const cardSpring = { type: 'spring', stiffness: 350, damping: 28 } as const
