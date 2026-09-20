import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

/** An error we raised deliberately, with a message already written for the caller. */
export class ToolError extends Error {
  readonly hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = "ToolError";
    this.hint = hint;
  }
}

export class WriteDisabledError extends ToolError {
  constructor(tool: string) {
    super(
      `Write operations are disabled, so '${tool}' did nothing.`,
      "Set YOUTUBE_ALLOW_WRITES=true and re-authorize (the read-only token lacks the write scope).",
    );
    this.name = "WriteDisabledError";
  }
}

export class NotAuthorizedError extends ToolError {
  constructor(what: string) {
    super(
      `${what} requires OAuth, and no valid token is loaded.`,
      "Run 'get_auth_url', open the URL, then pass the redirect URL to 'authorize'.",
    );
    this.name = "NotAuthorizedError";
  }
}

type GoogleErrorShape = {
  code?: number;
  status?: number;
  message?: string;
  errors?: Array<{ reason?: string; message?: string; domain?: string }>;
  response?: { status?: number; data?: { error?: GoogleErrorShape } };
};

function googleReason(err: GoogleErrorShape): string | undefined {
  return err.errors?.[0]?.reason ?? err.response?.data?.error?.errors?.[0]?.reason;
}

/**
 * Turn an arbitrary thrown value into a human-readable message plus an actionable hint.
 *
 * Google's client throws errors whose `message` is often just "Forbidden", with the useful
 * part buried in `errors[0].reason`. Quota exhaustion in particular is indistinguishable
 * from a permissions problem unless you look at the reason code, and it is by far the most
 * common failure in day-to-day use: `search.list` costs 100 units of a 10,000/day budget.
 */
export function describeError(error: unknown): { message: string; hint?: string } {
  if (error instanceof ToolError) {
    return error.hint ? { message: error.message, hint: error.hint } : { message: error.message };
  }
  if (error instanceof McpError) return { message: error.message };

  const err = (error ?? {}) as GoogleErrorShape;
  const status = err.code ?? err.status ?? err.response?.status;
  const reason = googleReason(err);
  const base =
    err.response?.data?.error?.message ??
    err.message ??
    (typeof error === "string" ? error : "Unknown error");

  switch (reason) {
    case "quotaExceeded":
    case "dailyLimitExceeded":
      return {
        message: `YouTube API quota exhausted: ${base}`,
        hint: "The daily quota is 10,000 units and resets at midnight Pacific Time. 'search_videos' and 'search_channels' cost 100 units per call; most other reads cost 1.",
      };
    case "rateLimitExceeded":
    case "userRateLimitExceeded":
      return { message: `Rate limited by YouTube: ${base}`, hint: "Retry in a few seconds." };
    case "forbidden":
    case "insufficientPermissions":
      return {
        message: `Not permitted: ${base}`,
        hint: "The token is missing a required scope, or the account does not own this resource. Re-authorize with 'get_auth_url'.",
      };
    case "videoNotFound":
      return { message: `Video not found: ${base}` };
    case "commentsDisabled":
      return { message: "Comments are disabled on this video." };
  }

  if (status === 401) {
    return {
      message: `Authentication failed: ${base}`,
      hint: "The token is expired or revoked. Re-authorize with 'get_auth_url'.",
    };
  }
  if (status === 404) return { message: `Not found: ${base}` };

  return { message: base };
}

/** Errors that should travel as protocol errors rather than tool results. */
export function isProtocolError(error: unknown): error is McpError {
  return (
    error instanceof McpError &&
    (error.code === ErrorCode.MethodNotFound || error.code === ErrorCode.InvalidRequest)
  );
}
