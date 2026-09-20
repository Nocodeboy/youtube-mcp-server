import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = { YOUTUBE_CLIENT_ID: "id", YOUTUBE_CLIENT_SECRET: "secret" };
const FORCE_SSL = "https://www.googleapis.com/auth/youtube.force-ssl";
const READONLY = "https://www.googleapis.com/auth/youtube.readonly";

describe("scope selection", () => {
  it("asks only for read scopes by default", () => {
    const c = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(c.allowWrites).toBe(false);
    expect(c.scopes).toContain(READONLY);
    expect(c.scopes).not.toContain(FORCE_SSL);
  });

  it("upgrades to the write scope only when writes are enabled", () => {
    const c = loadConfig({ ...base, YOUTUBE_ALLOW_WRITES: "true" } as NodeJS.ProcessEnv);
    expect(c.allowWrites).toBe(true);
    expect(c.scopes).toContain(FORCE_SSL);
    expect(c.scopes).not.toContain(READONLY);
  });

  it("needs the write scope for captions, since the API gives no read-only path", () => {
    const c = loadConfig({ ...base, YOUTUBE_ENABLE_CAPTIONS: "1" } as NodeJS.ProcessEnv);
    expect(c.allowWrites).toBe(false);
    expect(c.scopes).toContain(FORCE_SSL);
  });

  it("never requests the broad account-management scope", () => {
    for (const env of [base, { ...base, YOUTUBE_ALLOW_WRITES: "true" }]) {
      const c = loadConfig(env as NodeJS.ProcessEnv);
      expect(c.scopes).not.toContain("https://www.googleapis.com/auth/youtube");
    }
  });

  it("always requests analytics read access", () => {
    expect(loadConfig({ ...base } as NodeJS.ProcessEnv).scopes).toContain(
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    );
  });
});

describe("flag parsing", () => {
  it("treats common truthy spellings as true", () => {
    for (const v of ["true", "TRUE", "1", "yes", "on"]) {
      expect(loadConfig({ ...base, YOUTUBE_ALLOW_WRITES: v } as NodeJS.ProcessEnv).allowWrites).toBe(
        true,
      );
    }
  });

  it("treats anything else as false, so writes never turn on by accident", () => {
    for (const v of ["false", "0", "no", "", "maybe"]) {
      expect(loadConfig({ ...base, YOUTUBE_ALLOW_WRITES: v } as NodeJS.ProcessEnv).allowWrites).toBe(
        false,
      );
    }
  });
});

describe("credential detection", () => {
  it("requires both halves of the OAuth pair", () => {
    expect(loadConfig({ YOUTUBE_CLIENT_ID: "id" } as NodeJS.ProcessEnv).hasOAuthCredentials).toBe(
      false,
    );
    expect(loadConfig(base as NodeJS.ProcessEnv).hasOAuthCredentials).toBe(true);
  });

  it("rejects a malformed redirect URI instead of failing later at Google", () => {
    expect(() =>
      loadConfig({ ...base, YOUTUBE_REDIRECT_URI: "not-a-url" } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment/);
  });
});

describe("blank values (regression: .env.example broke startup)", () => {
  it("treats an empty string as unset, not as an invalid value", () => {
    // `cp .env.example .env` then filling in only the API key leaves the OAuth keys as "".
    // That used to fail validation and kill the process before the transport started.
    const c = loadConfig({
      YOUTUBE_API_KEY: "key",
      YOUTUBE_CLIENT_ID: "",
      YOUTUBE_CLIENT_SECRET: "",
      YOUTUBE_REDIRECT_URI: "",
      YOUTUBE_TOKEN_PATH: "",
      YOUTUBE_ALLOW_WRITES: "",
    } as NodeJS.ProcessEnv);

    expect(c.apiKey).toBe("key");
    expect(c.hasOAuthCredentials).toBe(false);
    expect(c.allowWrites).toBe(false);
    expect(c.redirectUri).toBe("http://localhost:8790/oauth2callback");
  });

  it("works with the OAuth half filled in and the API key blank", () => {
    const c = loadConfig({
      YOUTUBE_API_KEY: "",
      YOUTUBE_CLIENT_ID: "id",
      YOUTUBE_CLIENT_SECRET: "secret",
    } as NodeJS.ProcessEnv);
    expect(c.hasOAuthCredentials).toBe(true);
    expect(c.apiKey).toBeUndefined();
  });

  it("still rejects a genuinely malformed value", () => {
    expect(() =>
      loadConfig({ YOUTUBE_REDIRECT_URI: "nonsense" } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid environment/);
  });
});
