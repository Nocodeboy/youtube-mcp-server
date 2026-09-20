import { z } from "zod";
import { buildAuthUrl, extractAuthCode, grantedScopes } from "../auth/oauth.js";
import { json, text } from "../lib/result.js";
import type { ToolDefinition } from "./types.js";

export const authTools: ToolDefinition[] = [
  {
    name: "get_auth_url",
    title: "Get authorization URL",
    description:
      "Generate the Google consent URL to authorize this server against your YouTube account. " +
      "Open it in a browser, approve access, then pass the URL you land on to 'authorize'.",
    readOnlyHint: true,
    handler: async (_args, ctx) => {
      const client = ctx.requireOAuthClient();
      const url = buildAuthUrl(client, ctx.config.scopes);
      return text(
        [
          "1. Open this URL and approve access:",
          "",
          url,
          "",
          `2. Your browser will be redirected to ${ctx.config.redirectUri}, which will most likely`,
          "   show a connection error. That is expected — nothing is listening on that address.",
          "   Copy the FULL URL from the address bar (it contains ?code=...).",
          "",
          "3. Call 'authorize' with that URL.",
          "",
          `Scopes requested: ${ctx.config.scopes.join(", ")}`,
          ctx.config.allowWrites
            ? "Writes are ENABLED, so this grants permission to modify your channel."
            : "Writes are disabled, so this grants read-only access.",
        ].join("\n"),
      );
    },
  },
  {
    name: "authorize",
    title: "Complete authorization",
    description:
      "Exchange the authorization code for tokens and store them. Accepts the full redirect URL " +
      "or just the code.",
    inputSchema: {
      redirectUrl: z
        .string()
        .min(1)
        .describe("The full URL you were redirected to, or the bare authorization code"),
    },
    handler: async ({ redirectUrl }: { redirectUrl: string }, ctx) => {
      const client = ctx.requireOAuthClient();
      const code = extractAuthCode(redirectUrl);
      const { tokens } = await client.getToken(code);
      await ctx.applyCredentials(tokens);

      const granted = grantedScopes(tokens);
      return text(
        [
          "Authorization successful.",
          `Token stored at ${ctx.store.location} (owner read/write only).`,
          `Granted scopes: ${granted.length ? granted.join(", ") : "(not reported by Google)"}`,
          tokens.refresh_token
            ? "A refresh token was issued, so this will survive restarts."
            : "WARNING: Google did not return a refresh token. Access will expire in about an hour. " +
              "Revoke this app at https://myaccount.google.com/permissions and authorize again.",
        ].join("\n"),
      );
    },
  },
  {
    name: "auth_status",
    title: "Check authentication status",
    description:
      "Report how the server authenticated, which scopes are active, whether writes are enabled, " +
      "and which capabilities are therefore available. Use this first when a tool fails.",
    readOnlyHint: true,
    handler: async (_args, ctx) => {
      const credentials = await ctx.store.read();
      const scopes = ctx.activeScopes;
      const expiry = credentials?.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : undefined;

      return json({
        authMode: ctx.authMode,
        writesEnabled: ctx.config.allowWrites,
        captionsEnabled: ctx.config.enableCaptions,
        tokenPath: ctx.store.location,
        tokenPresent: Boolean(credentials),
        hasRefreshToken: Boolean(credentials?.refresh_token),
        accessTokenExpiresAt: expiry,
        grantedScopes: scopes,
        auditLogPath: ctx.config.auditLogPath,
        capabilities: {
          search: ctx.authMode !== "unauthenticated",
          videoDetails: ctx.authMode !== "unauthenticated",
          analytics: ctx.authMode === "oauth",
          captions: ctx.authMode === "oauth" && ctx.config.enableCaptions,
          writes: ctx.authMode === "oauth" && ctx.config.allowWrites,
        },
      });
    },
  },
];
