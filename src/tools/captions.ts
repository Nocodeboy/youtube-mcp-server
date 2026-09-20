import { z } from "zod";
import { json, text } from "../lib/result.js";
import { ToolError } from "../lib/errors.js";
import type { ToolDefinition } from "./types.js";

/**
 * Strip SubRip timing and index lines, leaving readable prose.
 * Consecutive duplicate lines are dropped: rolling captions repeat the same phrase across cues.
 */
export function srtToPlainText(srt: string): string {
  const lines = srt.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\d+$/.test(trimmed)) continue; // cue index
    if (/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(trimmed)) continue; // timing
    const clean = trimmed.replace(/<[^>]+>/g, "");
    if (clean && clean !== out[out.length - 1]) out.push(clean);
  }
  return out.join(" ");
}

function captionsGate(ctx: { config: { enableCaptions: boolean } }): void {
  if (!ctx.config.enableCaptions) {
    throw new ToolError(
      "Caption tools are disabled.",
      "Downloading captions needs the youtube.force-ssl scope, which is broader than read-only " +
        "access. Set YOUTUBE_ENABLE_CAPTIONS=true and re-authorize to opt in.",
    );
  }
}

export const captionTools: ToolDefinition[] = [
  {
    name: "list_captions",
    title: "List caption tracks",
    description:
      "List the caption tracks on a video. Only works for videos on the authorized channel: " +
      "the API does not expose other people's caption tracks.",
    readOnlyHint: true,
    oauthOnly: true,
    requiresCaptions: true,
    inputSchema: { videoId: z.string().min(1) },
    handler: async (args, ctx) => {
      captionsGate(ctx);
      const res = await ctx.requireYouTube().captions.list({
        part: ["snippet"],
        videoId: args.videoId,
      });
      const items = res.data.items ?? [];
      if (items.length === 0) {
        throw new ToolError(
          `No caption tracks on video '${args.videoId}'.`,
          "Either the video has no captions, or it is not on the authorized channel.",
        );
      }
      return json({
        items: items.map((c) => ({
          captionId: c.id,
          language: c.snippet?.language,
          name: c.snippet?.name,
          trackKind: c.snippet?.trackKind,
          isAutoSynced: c.snippet?.isAutoSynced,
          isDraft: c.snippet?.isDraft,
          lastUpdated: c.snippet?.lastUpdated,
        })),
      });
    },
  },
  {
    name: "get_transcript",
    title: "Download a transcript",
    description:
      "Download a caption track as plain text, SRT or VTT. Only works for videos on the " +
      "authorized channel. Pass a captionId from 'list_captions', or a videoId to pick a track.",
    readOnlyHint: true,
    oauthOnly: true,
    requiresCaptions: true,
    inputSchema: {
      captionId: z.string().optional().describe("From list_captions; takes precedence"),
      videoId: z.string().optional().describe("Used to auto-select a caption track"),
      language: z.string().optional().describe("Preferred language code, e.g. 'es' or 'en'"),
      format: z.enum(["text", "srt", "vtt"]).default("text"),
    },
    handler: async (args, ctx) => {
      captionsGate(ctx);
      const youtube = ctx.requireYouTube();

      let captionId = args.captionId;
      if (!captionId) {
        if (!args.videoId) throw new ToolError("Provide either 'captionId' or 'videoId'.");
        const list = await youtube.captions.list({ part: ["snippet"], videoId: args.videoId });
        const tracks = list.data.items ?? [];
        if (tracks.length === 0) {
          throw new ToolError(
            `No caption tracks on video '${args.videoId}'.`,
            "Either the video has no captions, or it is not on the authorized channel.",
          );
        }
        // Prefer the requested language, then a human-written track over an ASR one.
        const chosen =
          (args.language && tracks.find((t) => t.snippet?.language === args.language)) ||
          tracks.find((t) => t.snippet?.trackKind !== "ASR") ||
          tracks[0];
        captionId = chosen?.id ?? undefined;
        if (!captionId) throw new ToolError("Could not determine a caption track to download.");
      }

      // SRT is requested even for plain text, because it is the format we can reliably strip.
      const tfmt = args.format === "vtt" ? "vtt" : "srt";
      const res = await youtube.captions.download(
        { id: captionId, tfmt },
        { responseType: "text" },
      );
      const body = typeof res.data === "string" ? res.data : String(res.data ?? "");
      if (!body.trim()) throw new ToolError(`Caption track '${captionId}' came back empty.`);

      return text(args.format === "text" ? srtToPlainText(body) : body);
    },
  },
];
