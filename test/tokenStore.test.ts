import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TokenStore } from "../src/auth/tokenStore.js";

let dir: string;
let store: TokenStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-token-"));
  store = new TokenStore(path.join(dir, "token.json"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("TokenStore", () => {
  it("writes the token readable only by its owner", async () => {
    await store.write({ access_token: "a", refresh_token: "r" });
    const mode = (await fs.stat(store.location)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("tightens permissions on a file an older version left world-readable", async () => {
    await fs.writeFile(store.location, "{}", { mode: 0o644 });
    expect((await fs.stat(store.location)).mode & 0o777).toBe(0o644);

    await store.write({ access_token: "a" });
    expect((await fs.stat(store.location)).mode & 0o777).toBe(0o600);
  });

  it("returns null when no token exists", async () => {
    expect(await store.read()).toBeNull();
  });

  it("survives a corrupt token file instead of crashing the server", async () => {
    await fs.writeFile(store.location, "{ not json");
    expect(await store.read()).toBeNull();
  });

  it("keeps the refresh token when a refresh reply omits it", async () => {
    await store.write({ access_token: "old", refresh_token: "keep-me" });
    await store.merge({ access_token: "new", expiry_date: 123 });

    const stored = await store.read();
    expect(stored?.access_token).toBe("new");
    expect(stored?.refresh_token).toBe("keep-me");
    expect(stored?.expiry_date).toBe(123);
  });

  it("treats a token with no usable credentials as absent", async () => {
    await fs.writeFile(store.location, JSON.stringify({ scope: "x" }));
    expect(await store.read()).toBeNull();
  });
});
