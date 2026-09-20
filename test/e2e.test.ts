import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "dist", "index.js");

/**
 * Start the real built server as a subprocess and speak MCP to it.
 *
 * This is the check that matters most: the old server started cleanly and only fell over on
 * the first tool call. Anything short of a real handshake would have missed that.
 */
async function connect(env: Record<string, string>) {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY],
    env: { PATH: process.env.PATH ?? "", ...env },
    stderr: "pipe",
  });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

let dir: string;

beforeAll(async () => {
  await fs.access(ENTRY).catch(() => {
    throw new Error(`Build output missing at ${ENTRY}. Run 'npm run build' first.`);
  });
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-e2e-"));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const baseEnv = () => ({
  YOUTUBE_API_KEY: "fake-key-for-handshake",
  YOUTUBE_TOKEN_PATH: path.join(dir, "token.json"),
  YOUTUBE_AUDIT_LOG: path.join(dir, "audit.log"),
});

describe("server over stdio", () => {
  it("completes the MCP handshake and advertises read tools", async () => {
    const { client, close } = await connect(baseEnv());
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);

      expect(names).toContain("search_videos");
      expect(names).toContain("get_video_details");
      expect(names).toContain("auth_status");
      expect(names).toContain("analytics_top_videos");
      // Writes are off by default, so nothing mutating should be on the wire.
      expect(names).not.toContain("update_video");
      expect(names).not.toContain("reply_to_comment");
    } finally {
      await close();
    }
  });

  it("advertises write tools only when explicitly enabled", async () => {
    const { client, close } = await connect({ ...baseEnv(), YOUTUBE_ALLOW_WRITES: "true" });
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("update_video");
      expect(names).toContain("set_thumbnail");
      expect(names).toContain("remove_playlist_item");
    } finally {
      await close();
    }
  });

  it("starts with no credentials at all rather than refusing to boot", async () => {
    const { client, close } = await connect({
      YOUTUBE_TOKEN_PATH: path.join(dir, "none.json"),
      YOUTUBE_AUDIT_LOG: path.join(dir, "none.log"),
    });
    try {
      expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("answers auth_status without touching the network", async () => {
    const { client, close } = await connect(baseEnv());
    try {
      const result = await client.callTool({ name: "auth_status", arguments: {} });
      const body = (result.content as Array<{ type: string; text: string }>)[0];
      const status = JSON.parse(body!.text);

      expect(status.authMode).toBe("api-key");
      expect(status.writesEnabled).toBe(false);
      expect(status.capabilities.writes).toBe(false);
      expect(status.capabilities.analytics).toBe(false);
    } finally {
      await close();
    }
  });

  it("rejects invalid arguments instead of forwarding them to Google", async () => {
    const { client, close } = await connect(baseEnv());
    try {
      // maxResults is capped at 50 by the schema; the SDK validates before the handler runs.
      const result = await client.callTool({
        name: "search_videos",
        arguments: { query: "test", maxResults: 500 },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0]!.text;
      expect(text.toLowerCase()).toMatch(/maxresults|less than|invalid/);
    } finally {
      await close();
    }
  });

  it("explains that an OAuth-only tool needs OAuth, rather than failing at Google", async () => {
    const { client, close } = await connect(baseEnv()); // api-key mode
    try {
      const result = await client.callTool({ name: "get_my_channel", arguments: {} });
      expect(result.isError).toBe(true);

      // The guard must fire locally. Without it the call reached Google and came back as a
      // bare 401 that says nothing about how to fix it.
      const text = (result.content as Array<{ text: string }>)[0]!.text;
      expect(text).toMatch(/OAuth/);
      expect(text).toMatch(/get_auth_url/);
    } finally {
      await close();
    }
  });

  it("exposes the popular videos resource", async () => {
    const { client, close } = await connect(baseEnv());
    try {
      const { resources } = await client.listResources();
      expect(resources.map((r) => r.uri)).toContain("youtube://popular/videos");
    } finally {
      await close();
    }
  });
});
