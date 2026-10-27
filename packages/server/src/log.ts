/**
 * All logging goes to stderr (stdout stays clean for process supervisors).
 * The MCP `logging` capability is deprecated in the 2026-07-28 revision; stderr is
 * the recommended channel for locally-spawned servers.
 */
export function logError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : '';
  console.error(`[nextbillion-mcp] ${message}${detail}`);
}

export function logInfo(message: string): void {
  console.error(`[nextbillion-mcp] ${message}`);
}
