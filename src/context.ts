import { google, type youtube_v3, type youtubeAnalytics_v2 } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";
import type { Config } from "./config.js";
import { TokenStore } from "./auth/tokenStore.js";
import { createOAuthClient, grantedScopes } from "./auth/oauth.js";
import { AuditLog } from "./lib/auditLog.js";
import { NotAuthorizedError, ToolError, WriteDisabledError } from "./lib/errors.js";

export type AuthMode = "oauth" | "api-key" | "unauthenticated";

/**
 * Shared state for every tool: which API clients exist, how we authenticated, and the guards
 * that stand between a model's request and a real change to someone's channel.
 */
export class YouTubeContext {
  readonly config: Config;
  readonly store: TokenStore;
  readonly audit: AuditLog;

  private oauthClient: OAuth2Client | null = null;
  private youtube: youtube_v3.Youtube | null = null;
  private analytics: youtubeAnalytics_v2.Youtubeanalytics | null = null;
  private mode: AuthMode = "unauthenticated";
  private scopes: string[] = [];

  constructor(config: Config) {
    this.config = config;
    this.store = new TokenStore(config.tokenPath);
    this.audit = new AuditLog(config.auditLogPath);
  }

  get authMode(): AuthMode {
    return this.mode;
  }

  get activeScopes(): string[] {
    return [...this.scopes];
  }

  /**
   * Decide how to talk to YouTube, in order of capability: a stored OAuth token, then an API
   * key for read-only work, then nothing.
   *
   * Reaching the last state is not an error. A first-time user has OAuth credentials but has
   * not authorized yet, and needs the server to start so they can call `get_auth_url` at all.
   * What matters is that the state is recorded, so every other tool fails with an explanation
   * instead of a null dereference.
   */
  async initialize(): Promise<void> {
    if (this.config.hasOAuthCredentials) {
      this.oauthClient = createOAuthClient(this.config, this.store);
      const credentials = await this.store.read();

      if (credentials) {
        this.oauthClient.setCredentials(credentials);
        this.attachOAuthClients(this.oauthClient);
        this.scopes = grantedScopes(credentials);
        this.mode = "oauth";
        console.error(
          `[auth] OAuth token loaded from ${this.store.location} ` +
            `(writes ${this.config.allowWrites ? "enabled" : "disabled"})`,
        );
        return;
      }
      console.error(`[auth] no token at ${this.store.location} — run 'get_auth_url' to authorize.`);
    }

    if (this.config.apiKey) {
      this.youtube = google.youtube({ version: "v3", auth: this.config.apiKey });
      this.mode = "api-key";
      console.error("[auth] using API key (read-only; Analytics unavailable)");
      return;
    }

    this.mode = "unauthenticated";
    if (!this.config.hasOAuthCredentials) {
      console.error(
        "[auth] no credentials configured. Set YOUTUBE_API_KEY, or " +
          "YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET for OAuth.",
      );
    }
  }

  /**
   * Build both API clients from one authorized OAuth client.
   *
   * Analytics is created here rather than only after an interactive authorization, so it
   * survives a restart: a stored token is enough, and the user never has to re-run the OAuth
   * flow just to read their own numbers.
   */
  private attachOAuthClients(client: OAuth2Client): void {
    this.youtube = google.youtube({ version: "v3", auth: client });
    this.analytics = google.youtubeAnalytics({ version: "v2", auth: client });
  }

  /** Adopt credentials obtained by an interactive authorization. */
  async applyCredentials(credentials: Credentials): Promise<void> {
    const client = this.requireOAuthClient();
    client.setCredentials(credentials);
    await this.store.merge(credentials);
    this.attachOAuthClients(client);
    this.scopes = grantedScopes(credentials);
    this.mode = "oauth";
  }

  requireOAuthClient(): OAuth2Client {
    if (!this.oauthClient) {
      throw new ToolError(
        "OAuth is not configured.",
        "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET, then restart the server.",
      );
    }
    return this.oauthClient;
  }

  requireYouTube(): youtube_v3.Youtube {
    if (!this.youtube) {
      throw new NotAuthorizedError("This tool");
    }
    return this.youtube;
  }

  requireAnalytics(): youtubeAnalytics_v2.Youtubeanalytics {
    if (!this.analytics) {
      if (this.mode === "api-key") {
        throw new ToolError(
          "The YouTube Analytics API cannot be used with an API key.",
          "Analytics reports channel-owner data, so it needs OAuth. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET, then run 'get_auth_url'.",
        );
      }
      throw new NotAuthorizedError("Analytics");
    }
    return this.analytics;
  }

  /**
   * Gate for every mutating tool.
   *
   * Writes are off unless explicitly enabled, because this server hands channel-changing
   * power to a model that also reads untrusted text — video descriptions and viewer comments.
   * A blocked attempt is logged too: it is the signal that something tried to write when it
   * should not have.
   */
  async requireWrites(tool: string, target?: Record<string, unknown>): Promise<youtube_v3.Youtube> {
    if (!this.config.allowWrites) {
      await this.audit.record({ tool, outcome: "blocked", target });
      throw new WriteDisabledError(tool);
    }
    const client = this.requireYouTube();
    if (this.mode !== "oauth") {
      throw new NotAuthorizedError(`Writing via '${tool}'`);
    }
    return client;
  }
}
