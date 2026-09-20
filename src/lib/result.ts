import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeError } from "./errors.js";

export function text(body: string): CallToolResult {
  return { content: [{ type: "text", text: body }] };
}

/**
 * Serialize a payload for the model.
 *
 * `JSON.stringify(undefined)` returns the *value* `undefined`, not a string, which would put an
 * invalid `text` field on the wire. Guarding here means no individual tool has to remember.
 */
export function json(payload: unknown): CallToolResult {
  if (payload === undefined) return text("No data returned.");
  return text(JSON.stringify(payload, null, 2));
}

export function errorResult(error: unknown): CallToolResult {
  const { message, hint } = describeError(error);
  return {
    content: [{ type: "text", text: hint ? `${message}\n\nHint: ${hint}` : message }],
    isError: true,
  };
}
