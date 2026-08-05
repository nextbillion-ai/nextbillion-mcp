import type * as z from 'zod/v4';
import type { NbClient } from '../nbclient/client.js';

/** Subset of the MCP CallToolResult shape produced by our tools. */
export interface ToolResult {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * One NextBillion API wrapped as an MCP tool. Every tool is a plain object so the
 * registry can sort and register them uniformly and tests can call `run` directly.
 */
export interface NbTool<Schema extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  annotations?: ToolAnnotations;
  run(args: z.output<Schema>, nb: NbClient): Promise<ToolResult>;
}

/** All NextBillion Phase 1 APIs are read-only queries against an open dataset. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export class ToolInputError extends Error {}

export function textResult(text: string, structuredContent?: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent };
}
