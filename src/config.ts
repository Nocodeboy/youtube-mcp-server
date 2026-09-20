import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
/** `dist/` at runtime, `src/` under ts-node — the project root is one level up either way. */
export const PROJECT_ROOT = path.resolve(here, "..");

dotenv.config({ path: path.join(PROJECT_ROOT, ".env"), quiet: true });

const boolish = z
  .string()
  .transform((v) => ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()));

const EnvSchema = z.object({
  YOUTUBE_API_KEY: z.string().min(1).optional(),
  YOUTUBE_CLIENT_ID: z.string().min(1).optional(),
  YOUTUBE_CLIENT_SECRET: z.string().min(1).optional(),
  YOUTUBE_REDIRECT_URI: z.string().url().default("http://localhost:8790/oauth2callback"),
  YOUTUBE_TOKEN_PATH: z.string().optional(),
  YOUTUBE_AUDIT_LOG: z.string().optional(),
  YOUTUBE_ALLOW_WRITES: boolish.default(false),
  YOUTUBE_ENABLE_CAPTIONS: boolish.default(false),
  YOUTUBE_MAX_THUMBNAIL_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
});

export type Config = {
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  tokenPath: string;
  auditLogPath: string;
  allowWrites: boolean;
  enableCaptions: boolean;
  maxThumbnailBytes: number;
  scopes: string[];
  hasOAuthCredentials: boolean;
};

const SCOPE = {
  readonly: "https://www.googleapis.com/auth/youtube.readonly",
  forceSsl: "https://www.googleapis.com/auth/youtube.force-ssl",
  analytics: "https://www.googleapis.com/auth/yt-analytics.readonly",
} as const;

/**
 * Least privilege: only ask Google for what the current configuration can actually use.
 *
 * `youtube.force-ssl` is the read/write scope. Captions download requires it even though
 * downloading a transcript is a read, so enabling captions widens the grant beyond what a
 * read-only setup strictly needs. The write guard still blocks every mutating tool in that
 * case, but the *token* is more powerful than the server — a deliberate, documented trade-off.
 *
 * Note we never request the bare `auth/youtube` scope: it allows deleting videos and comments,
 * which no tool here does.
 */
function resolveScopes(allowWrites: boolean, enableCaptions: boolean): string[] {
  const scopes: string[] = [SCOPE.analytics];
  scopes.push(allowWrites || enableCaptions ? SCOPE.forceSsl : SCOPE.readonly);
  return scopes;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const tokenPath = e.YOUTUBE_TOKEN_PATH
    ? path.resolve(e.YOUTUBE_TOKEN_PATH)
    : path.join(PROJECT_ROOT, "token.json");

  return {
    apiKey: e.YOUTUBE_API_KEY,
    clientId: e.YOUTUBE_CLIENT_ID,
    clientSecret: e.YOUTUBE_CLIENT_SECRET,
    redirectUri: e.YOUTUBE_REDIRECT_URI,
    tokenPath,
    auditLogPath: e.YOUTUBE_AUDIT_LOG
      ? path.resolve(e.YOUTUBE_AUDIT_LOG)
      : path.join(path.dirname(tokenPath), "youtube-mcp-audit.log"),
    allowWrites: e.YOUTUBE_ALLOW_WRITES,
    enableCaptions: e.YOUTUBE_ENABLE_CAPTIONS,
    maxThumbnailBytes: e.YOUTUBE_MAX_THUMBNAIL_BYTES,
    scopes: resolveScopes(e.YOUTUBE_ALLOW_WRITES, e.YOUTUBE_ENABLE_CAPTIONS),
    hasOAuthCredentials: Boolean(e.YOUTUBE_CLIENT_ID && e.YOUTUBE_CLIENT_SECRET),
  };
}
