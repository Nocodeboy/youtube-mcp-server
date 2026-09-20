import type { ZodRawShape } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { YouTubeContext } from "../context.js";

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema?: ZodRawShape;
  /** Mutating tools are registered only when writes are enabled. */
  write?: boolean;
  /** Requires OAuth; not reachable with an API key alone. */
  oauthOnly?: boolean;
  /** Gated behind YOUTUBE_ENABLE_CAPTIONS, which widens the OAuth scope. */
  requiresCaptions?: boolean;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  handler: (args: any, ctx: YouTubeContext) => Promise<CallToolResult>;
};
