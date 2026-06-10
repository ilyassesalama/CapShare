import { useEffect, type Dispatch, type SetStateAction } from 'react'

interface RunningTask {
  state: 'running'
  taskId: string
  ratio: number
}

/**
 * Mirrors task progress events into a phase state: while the phase is
 * 'running' and the task ids match, keeps `ratio` current; otherwise leaves
 * the phase untouched. Works for any phase union whose 'running' member
 * carries `taskId` + `ratio` (the export and import flows).
 */
export function useTaskProgress<T extends { state: string }>(
  setPhase: Dispatch<SetStateAction<T>>
): void {
  useEffect(() => {
    return window.capshare.onProgress((event) => {
      setPhase((current) => {
        if (current.state !== 'running') return current
        const running = current as T & RunningTask
        return running.taskId === event.taskId ? { ...running, ratio: event.ratio } : current
      })
    })
  }, [setPhase])
}
