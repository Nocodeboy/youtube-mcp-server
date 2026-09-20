import { z } from "zod";
import { formatChannel, formatPlaylistItem } from "../lib/format.js";
import { json } from "../lib/result.js";
import { ToolError } from "../lib/errors.js";
import type { ToolDefinition } from "./types.js";

const CHANNEL_PARTS = ["snippet", "statistics", "contentDetails"];

export const channelTools: ToolDefinition[] = [
  {
    name: "get_channel_details",
    title: "Get channel details",
    description:
      "Fetch a channel's metadata and statistics by channel ID or by handle (e.g. @Nocodeboy).",
    readOnlyHint: true,
    inputSchema: {
      channelId: z.string().optional().describe("Channel ID, starts with UC"),
      handle: z.string().optional().describe("Channel handle, with or without the leading @"),
    },
    handler: async ({ channelId, handle }: { channelId?: string; handle?: string }, ctx) => {
      if (!channelId && !handle) {
        throw new ToolError("Provide either 'channelId' or 'handle'.");
      }
      const res = await ctx.requireYouTube().channels.list({
        part: CHANNEL_PARTS,
        ...(channelId
          ? { id: [channelId] }
          : { forHandle: handle!.startsWith("@") ? handle : `@${handle}` }),
      });
      const item = res.data.items?.[0];
      if (!item) {
        throw new ToolError(
          `No channel found for ${channelId ? `ID '${channelId}'` : `handle '${handle}'`}.`,
        );
      }
      return json(formatChannel(item));
    },
  },
  {
    name: "get_my_channel",
    title: "Get my channel",
    description:
      "Fetch the authenticated user's own channel, including the uploads playlist ID needed by " +
      "'list_playlist_items' to page through every video on the channel.",
    readOnlyHint: true,
    oauthOnly: true,
    handler: async (_args, ctx) => {
      const res = await ctx.requireYouTube().channels.list({
        part: CHANNEL_PARTS,
        mine: true,
      });
      const item = res.data.items?.[0];
      if (!item) {
        throw new ToolError(
          "The authorized account has no YouTube channel.",
          "Create a channel at youtube.com, or authorize with an account that has one.",
        );
      }
      return json(formatChannel(item));
    },
  },
  {
    name: "list_channel_videos",
    title: "List a channel's videos",
    description:
      "List a channel's uploads, newest first, by paging its uploads playlist. Costs 1 quota " +
      "unit per call, unlike 'search_videos' which costs 100.",
    readOnlyHint: true,
    inputSchema: {
      channelId: z.string().optional().describe("Defaults to the authenticated user's channel"),
      maxResults: z.number().int().min(1).max(50).default(25),
      pageToken: z.string().optional(),
    },
    handler: async (args, ctx) => {
      const youtube = ctx.requireYouTube();
      const channels = await youtube.channels.list({
        part: ["contentDetails", "snippet"],
        ...(args.channelId ? { id: [args.channelId] } : { mine: true }),
      });
      const channel = channels.data.items?.[0];
      const uploads = channel?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) {
        throw new ToolError(
          args.channelId
            ? `No uploads playlist found for channel '${args.channelId}'.`
            : "No uploads playlist found. Pass 'channelId', or authorize an account with a channel.",
        );
      }
      const res = await youtube.playlistItems.list({
        part: ["snippet", "contentDetails"],
        playlistId: uploads,
        maxResults: args.maxResults,
        pageToken: args.pageToken,
      });
      return json({
        channelTitle: channel?.snippet?.title,
        uploadsPlaylistId: uploads,
        nextPageToken: res.data.nextPageToken ?? undefined,
        items: (res.data.items ?? []).map(formatPlaylistItem),
      });
    },
  },
];
