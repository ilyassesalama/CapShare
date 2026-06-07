import type { CapShareErrorShape, IpcResult } from '@shared/types'

/** Unwraps an IpcResult, throwing a typed error for the UI layer to toast. */
export function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.data
  throw new IpcError(result.error)
}

export class IpcError extends Error {
  readonly shape: CapShareErrorShape

  constructor(shape: CapShareErrorShape) {
    super(shape.message)
    this.name = 'IpcError'
    this.shape = shape
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof IpcError) return error.shape.message
  if (error instanceof Error) return error.message
  return String(error)
}
