import { Readable } from "node:stream";
import { z } from "zod";
import { formatVideo } from "../lib/format.js";
import { json, text } from "../lib/result.js";
import { ToolError } from "../lib/errors.js";
import { fetchImage } from "../lib/safeFetch.js";
import type { ToolDefinition } from "./types.js";

export const videoTools: ToolDefinition[] = [
  {
    name: "get_video_details",
    title: "Get video details",
    description:
      "Fetch metadata, statistics and status for one or more videos. Costs 1 quota unit " +
      "regardless of how many IDs you pass, so batch them.",
    readOnlyHint: true,
    inputSchema: {
      videoIds: z
        .array(z.string().min(1))
        .min(1)
        .max(50)
        .describe("One or more YouTube video IDs"),
    },
    handler: async ({ videoIds }: { videoIds: string[] }, ctx) => {
      const res = await ctx.requireYouTube().videos.list({
        part: ["snippet", "statistics", "status", "contentDetails"],
        id: videoIds,
      });
      const items = res.data.items ?? [];

      // The API returns 200 with an empty list for IDs that are wrong, private or deleted.
      // Reporting that explicitly beats handing back an empty array the model has to interpret.
      if (items.length === 0) {
        throw new ToolError(
          `No videos found for: ${videoIds.join(", ")}`,
          "The IDs may be wrong, or the videos private or deleted.",
        );
      }
      const found = new Set(items.map((i) => i.id));
      const missing = videoIds.filter((id) => !found.has(id));

      return json({
        items: items.map(formatVideo),
        ...(missing.length ? { notFound: missing } : {}),
      });
    },
  },
  {
    name: "update_video",
    title: "Update video metadata",
    description:
      "Update a video's title, description, tags or privacy status. Only the fields you pass " +
      "are changed. Pass an empty string to clear the description. Use dryRun to preview.",
    write: true,
    oauthOnly: true,
    inputSchema: {
      videoId: z.string().min(1),
      title: z.string().max(100).optional().describe("Max 100 characters, per YouTube"),
      description: z.string().max(5000).optional().describe("Empty string clears it"),
      tags: z.array(z.string()).optional(),
      privacyStatus: z.enum(["public", "unlisted", "private"]).optional(),
      dryRun: z
        .boolean()
        .default(false)
        .describe("Report what would change without sending the update"),
    },
    handler: async (args, ctx) => {
      const target = { videoId: args.videoId };
      const youtube = args.dryRun
        ? ctx.requireYouTube()
        : await ctx.requireWrites("update_video", target);

      const current = await youtube.videos.list({
        part: ["snippet", "status"],
        id: [args.videoId],
      });
      const video = current.data.items?.[0];
      if (!video?.snippet) {
        throw new ToolError(
          `Video '${args.videoId}' not found, or the authorized account cannot edit it.`,
        );
      }

      // `videos.update` replaces the whole snippet: anything omitted is wiped. So start from
      // what is on YouTube right now and overlay only the requested fields. categoryId is
      // required by the API and easy to lose this way.
      const snippet = { ...video.snippet };
      const status = { ...video.status };
      const changes: Record<string, { from: unknown; to: unknown }> = {};

      // `!== undefined` rather than a truthiness check, so an empty string can clear a field.
      if (args.title !== undefined && args.title !== snippet.title) {
        changes.title = { from: snippet.title, to: args.title };
        snippet.title = args.title;
      }
      if (args.description !== undefined && args.description !== snippet.description) {
        changes.description = {
          from: `${(snippet.description ?? "").slice(0, 80)}...`,
          to: args.description === "" ? "(cleared)" : `${args.description.slice(0, 80)}...`,
        };
        snippet.description = args.description;
      }
      // Compare before recording a change: re-sending identical tags would otherwise defeat
      // the "no changes" short-circuit and spend ~50 quota units on a no-op update.
      const currentTags = snippet.tags ?? [];
      const sameTags =
        args.tags !== undefined &&
        currentTags.length === args.tags.length &&
        currentTags.every((t, i) => t === args.tags[i]);
      if (args.tags !== undefined && !sameTags) {
        changes.tags = { from: currentTags, to: args.tags };
        snippet.tags = args.tags;
      }
      if (args.privacyStatus !== undefined && args.privacyStatus !== status.privacyStatus) {
        changes.privacyStatus = { from: status.privacyStatus, to: args.privacyStatus };
        status.privacyStatus = args.privacyStatus;
      }

      if (Object.keys(changes).length === 0) {
        return text("No changes: every field you passed already matches the video.");
      }
      if (!snippet.categoryId) {
        throw new ToolError(
          "This video has no categoryId, which YouTube requires on update.",
          "Set a category once in YouTube Studio, then retry.",
        );
      }

      if (args.dryRun) {
        return json({ dryRun: true, videoId: args.videoId, wouldChange: changes });
      }

      // Send `status` only when privacy was actually requested, to avoid writing back a stale
      // copy of fields (licence, embeddable, publishAt) read moments earlier.
      const parts = args.privacyStatus !== undefined ? ["snippet", "status"] : ["snippet"];
      await youtube.videos.update({
        part: parts,
        requestBody: {
          id: args.videoId,
          snippet,
          ...(args.privacyStatus !== undefined ? { status } : {}),
        },
      });

      await ctx.audit.record({
        tool: "update_video",
        outcome: "allowed",
        target,
        detail: JSON.stringify(changes),
      });
      return json({ updated: true, videoId: args.videoId, changed: changes });
    },
  },
  {
    name: "set_thumbnail",
    title: "Set video thumbnail",
    description:
      "Set a custom thumbnail from an HTTPS image URL (JPEG or PNG, max 2 MB). The URL is " +
      "checked before fetching: private and link-local addresses are refused.",
    write: true,
    oauthOnly: true,
    inputSchema: {
      videoId: z.string().min(1),
      imageUrl: z.string().url().describe("Public HTTPS URL of a JPEG or PNG image"),
    },
    handler: async (args, ctx) => {
      const target = { videoId: args.videoId, imageUrl: args.imageUrl };
      const youtube = await ctx.requireWrites("set_thumbnail", target);

      const { bytes, mimeType } = await fetchImage(
        args.imageUrl,
        ctx.config.maxThumbnailBytes,
      );

      await youtube.thumbnails.set({
        videoId: args.videoId,
        // googleapis streams the upload body; a Buffer is not accepted directly.
        media: { mimeType, body: Readable.from(bytes) },
      });

      await ctx.audit.record({
        tool: "set_thumbnail",
        outcome: "allowed",
        target,
        detail: `${bytes.byteLength} bytes, ${mimeType}`,
      });
      return text(
        `Thumbnail updated for ${args.videoId} (${bytes.byteLength} bytes, ${mimeType}).`,
      );
    },
  },
];
