import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import type { Config } from "../config.js";
import { TokenStore } from "./tokenStore.js";
import { ToolError } from "../lib/errors.js";

export function createOAuthClient(config: Config, store: TokenStore): OAuth2Client {
  const client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );

  /**
   * Google refreshes the access token transparently, but only in memory. Without this listener
   * the file on disk goes stale the moment the first access token expires, and a rotated
   * refresh token would be lost entirely — the next cold start would fail with no explanation.
   */
  client.on("tokens", (tokens: Credentials) => {
    void store.merge(tokens).catch((error) => {
      console.error(`[auth] failed to persist refreshed token: ${String(error)}`);
    });
  });

  return client;
}

export function buildAuthUrl(client: OAuth2Client, scopes: string[]): string {
  return client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    // Without this Google omits the refresh token on re-authorization, which silently
    // produces a token that dies in an hour and cannot be renewed.
    prompt: "consent",
    include_granted_scopes: true,
  });
}

/** Accept either the raw `code` or the whole redirect URL the browser landed on. */
export function extractAuthCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ToolError("No authorization code or redirect URL was provided.");

  if (trimmed.includes("://") || trimmed.startsWith("?") || trimmed.includes("code=")) {
    let url: URL;
    try {
      url = new URL(trimmed.startsWith("?") ? `http://localhost${trimmed}` : trimmed);
    } catch {
      // Not parseable as a URL — fall through and treat the input as a bare code.
      return trimmed;
    }
    const error = url.searchParams.get("error");
    if (error) {
      throw new ToolError(
        `Google returned an authorization error: ${error}`,
        url.searchParams.get("error_description") ?? undefined,
      );
    }
    const code = url.searchParams.get("code");
    if (code) return code;
    throw new ToolError(
      "That redirect URL has no 'code' parameter.",
      "Copy the full URL from the browser address bar after approving access, including everything after '?'.",
    );
  }
  return trimmed;
}

/** Scopes actually attached to the stored token, per Google (not what we asked for). */
export function grantedScopes(credentials: Credentials | null): string[] {
  return credentials?.scope ? credentials.scope.split(" ").filter(Boolean) : [];
}
