import type { CapShareErrorShape } from '../../shared/types'

export type CapShareErrorCode = CapShareErrorShape['code']

/**
 * Typed error used across the core pipelines. The IPC layer converts these
 * into CapShareErrorShape DTOs; unknown errors are wrapped as 'UNKNOWN'.
 */
export class CapShareError extends Error {
  readonly code: CapShareErrorCode
  readonly detail?: string

  constructor(code: CapShareErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'CapShareError'
    this.code = code
    this.detail = detail
  }

  toShape(): CapShareErrorShape {
    return { code: this.code, message: this.message, detail: this.detail }
  }

  static wrap(error: unknown, fallbackCode: CapShareErrorCode = 'UNKNOWN'): CapShareError {
    if (error instanceof CapShareError) return error
    const message = error instanceof Error ? error.message : String(error)
    return new CapShareError(fallbackCode, message)
  }
}
