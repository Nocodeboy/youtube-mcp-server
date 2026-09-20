import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Checks that hit the real YouTube API.
 *
 * Skipped unless YOUTUBE_API_KEY is set, so `npm test` stays offline by default. Everything
 * here is read-only and uses an API key, which cannot write even if a tool tried.
 *
 * Quota: one search (100 units) plus a handful of 1-unit reads, so about 105 units of the
 * 10,000/day budget per run. Keep it that way — do not add more searches.
 */
const API_KEY = process.env.YOUTUBE_API_KEY;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "dist", "index.js");

// "Me at the zoo", the first video on YouTube. Public since 2005 and not going anywhere.
const STABLE_VIDEO_ID = "jNQXAC9IVRw";

let dir: string;
let client: Client;

const textOf = (r: { content: unknown }) => (r.content as Array<{ text: string }>)[0]!.text;
const jsonOf = (r: { content: unknown }) => JSON.parse(textOf(r));

describe.skipIf(!API_KEY)("live YouTube API (read-only)", () => {
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "yt-live-"));
    client = new Client({ name: "live-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [ENTRY],
        env: {
          PATH: process.env.PATH ?? "",
          ...(process.env.NODE_EXTRA_CA_CERTS
            ? { NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS }
            : {}),
          ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
          YOUTUBE_API_KEY: API_KEY!,
          YOUTUBE_TOKEN_PATH: path.join(dir, "token.json"),
          YOUTUBE_AUDIT_LOG: path.join(dir, "audit.log"),
        },
        stderr: "pipe",
      }),
    );
  });

  afterAll(async () => {
    await client?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("fetches a real video and projects the fields we promise", async () => {
    const out = jsonOf(
      await client.callTool({
        name: "get_video_details",
        arguments: { videoIds: [STABLE_VIDEO_ID] },
      }),
    );
    const video = out.items[0];

    expect(video.id).toBe(STABLE_VIDEO_ID);
    expect(typeof video.title).toBe("string");
    expect(video.url).toBe(`https://www.youtube.com/watch?v=${STABLE_VIDEO_ID}`);
    // Counts must arrive as numbers, not the strings the API sends.
    expect(typeof video.viewCount).toBe("number");
    expect(video.viewCount).toBeGreaterThan(0);
    // ISO-8601 duration must have been humanized.
    expect(video.duration).toMatch(/^\d+:\d{2}(:\d{2})?$/);
    expect(video.privacyStatus).toBe("public");
    // API noise must be gone.
    expect(video).not.toHaveProperty("etag");
    expect(video).not.toHaveProperty("kind");
  });

  it("reports IDs the API silently omits", async () => {
    const out = jsonOf(
      await client.callTool({
        name: "get_video_details",
        arguments: { videoIds: [STABLE_VIDEO_ID, "zzzzzzzzzzz"] },
      }),
    );
    expect(out.items).toHaveLength(1);
    expect(out.notFound).toEqual(["zzzzzzzzzzz"]);
  });

  it("errors clearly when nothing matches at all", async () => {
    const result = await client.callTool({
      name: "get_video_details",
      arguments: { videoIds: ["zzzzzzzzzzz"] },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No videos found/);
  });

  it("resolves a channel by handle", async () => {
    const out = jsonOf(
      await client.callTool({
        name: "get_channel_details",
        arguments: { handle: "@YouTube" },
      }),
    );
    expect(out.id).toMatch(/^UC/);
    expect(typeof out.title).toBe("string");
    expect(typeof out.subscriberCount).toBe("number");
    expect(out.uploadsPlaylistId).toMatch(/^UU/);
  });

  it("pages a channel's uploads for one quota unit", async () => {
    const channel = jsonOf(
      await client.callTool({ name: "get_channel_details", arguments: { handle: "@YouTube" } }),
    );
    const out = jsonOf(
      await client.callTool({
        name: "list_playlist_items",
        arguments: { playlistId: channel.uploadsPlaylistId, maxResults: 5 },
      }),
    );
    expect(out.items.length).toBeGreaterThan(0);
    expect(out.items[0].videoId).toBeTruthy();
    expect(out.items[0].url).toContain("youtube.com/watch");
  });

  it("searches (100 quota units — the only search in this suite)", async () => {
    const out = jsonOf(
      await client.callTool({
        name: "search_videos",
        arguments: { query: "model context protocol", maxResults: 3 },
      }),
    );
    expect(out.items.length).toBeGreaterThan(0);
    expect(out.items[0].type).toBe("video");
    expect(out.items[0].id).toBeTruthy();
    expect(out.items[0]).toHaveProperty("thumbnail");
  });

  it("serves the popular videos resource", async () => {
    const res = await client.readResource({ uri: "youtube://popular/videos" });
    const items = JSON.parse((res.contents[0] as { text: string }).text);
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty("title");
    expect(typeof items[0].viewCount).toBe("number");
  });

  it("explains that Analytics needs OAuth rather than failing at Google", async () => {
    const result = await client.callTool({
      name: "analytics_channel_summary",
      arguments: { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "total" },
    });
    expect(result.isError).toBe(true);
    // The guard must fire locally and name both the problem and the fix.
    const body = textOf(result);
    expect(body).toMatch(/cannot work with an API key/);
    expect(body).toMatch(/get_auth_url/);
  });
});

describe.skipIf(API_KEY)("live suite", () => {
  it("is skipped without YOUTUBE_API_KEY", () => {
    expect(API_KEY).toBeUndefined();
  });
});
