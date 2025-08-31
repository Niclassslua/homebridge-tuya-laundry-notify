export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string') return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

export function errorStack(e: unknown): string | undefined {
  return e instanceof Error ? e.stack : undefined;
}
