/** Small shared helpers. */

export function now(): string {
  return new Date().toISOString()
}

export function uid(): string {
  return crypto.randomUUID()
}
