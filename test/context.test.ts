import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { YouTubeContext } from "../src/context.js";
import { WriteDisabledError, NotAuthorizedError, describeError } from "../src/lib/errors.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-ctx-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    YOUTUBE_TOKEN_PATH: path.join(dir, "token.json"),
    YOUTUBE_AUDIT_LOG: path.join(dir, "audit.log"),
    ...extra,
  } as NodeJS.ProcessEnv;
}

async function writeToken(): Promise<void> {
  await fs.writeFile(
    path.join(dir, "token.json"),
    JSON.stringify({
      access_token: "at",
      refresh_token: "rt",
      scope: "https://www.googleapis.com/auth/youtube.readonly",
    }),
  );
}

async function build(extra: Record<string, string> = {}): Promise<YouTubeContext> {
  const ctx = new YouTubeContext(loadConfig(env(extra)));
  await ctx.initialize();
  return ctx;
}

const oauthEnv = { YOUTUBE_CLIENT_ID: "id", YOUTUBE_CLIENT_SECRET: "secret" };

describe("initialize (regression: Analytics died on restart)", () => {
  it("builds the Analytics client from a stored token, with no re-authorization", async () => {
    await writeToken();
    const ctx = await build(oauthEnv);

    expect(ctx.authMode).toBe("oauth");
    // The bug: youtubeAnalytics was only ever assigned inside the interactive authorize
    // handler, so every restart left analytics tools throwing "Analytics no configurado".
    expect(() => ctx.requireAnalytics()).not.toThrow();
    expect(() => ctx.requireYouTube()).not.toThrow();
  });
});

describe("initialize (regression: null client crashed every tool)", () => {
  it("reports an actionable error when OAuth is set up but not yet authorized", async () => {
    const ctx = await build(oauthEnv); // credentials present, no token on disk, no API key

    expect(ctx.authMode).toBe("unauthenticated");
    // The bug: initialize() returned with this.youtube still null, so the first tool call
    // died with "Cannot read properties of null (reading 'search')".
    expect(() => ctx.requireYouTube()).toThrow(NotAuthorizedError);

    // What the model actually receives is message + hint, so assert on the rendered form:
    // the error is only useful if it names the tool that fixes it.
    const rendered = (() => {
      try {
        ctx.requireYouTube();
        return "";
      } catch (error) {
        const { message, hint } = describeError(error);
        return `${message} ${hint ?? ""}`;
      }
    })();
    expect(rendered).toMatch(/get_auth_url/);
  });

  it("falls back to the API key when there is no token", async () => {
    const ctx = await build({ ...oauthEnv, YOUTUBE_API_KEY: "key" });
    expect(ctx.authMode).toBe("api-key");
    expect(() => ctx.requireYouTube()).not.toThrow();
  });

  it("explains that Analytics cannot work with an API key", async () => {
    const ctx = await build({ YOUTUBE_API_KEY: "key" });
    expect(() => ctx.requireAnalytics()).toThrow(/cannot be used with an API key/);
  });
});

describe("write guard", () => {
  it("blocks writes by default and records the attempt", async () => {
    await writeToken();
    const ctx = await build(oauthEnv);

    await expect(ctx.requireWrites("update_video", { videoId: "v1" })).rejects.toThrow(
      WriteDisabledError,
    );

    const log = await fs.readFile(path.join(dir, "audit.log"), "utf-8");
    const entry = JSON.parse(log.trim());
    expect(entry.outcome).toBe("blocked");
    expect(entry.tool).toBe("update_video");
    expect(entry.target).toEqual({ videoId: "v1" });
  });

  it("allows writes once the flag is set", async () => {
    await writeToken();
    const ctx = await build({ ...oauthEnv, YOUTUBE_ALLOW_WRITES: "true" });
    await expect(ctx.requireWrites("update_video")).resolves.toBeDefined();
  });

  it("refuses writes in API-key mode even when the flag is set", async () => {
    const ctx = await build({ YOUTUBE_API_KEY: "key", YOUTUBE_ALLOW_WRITES: "true" });
    await expect(ctx.requireWrites("update_video")).rejects.toThrow(NotAuthorizedError);
  });

  it("writes the audit log with owner-only permissions", async () => {
    await writeToken();
    const ctx = await build(oauthEnv);
    await ctx.requireWrites("reply_to_comment").catch(() => {});

    const mode = (await fs.stat(path.join(dir, "audit.log"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
