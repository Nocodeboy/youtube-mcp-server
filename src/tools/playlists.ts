import { z } from "zod";
import { formatPlaylist, formatPlaylistItem } from "../lib/format.js";
import { json, text } from "../lib/result.js";
import { ToolError } from "../lib/errors.js";
import type { ToolDefinition } from "./types.js";

export const playlistTools: ToolDefinition[] = [
  {
    name: "list_playlists",
    title: "List playlists",
    description: "List playlists for a channel, or for the authenticated user when no ID is given.",
    readOnlyHint: true,
    inputSchema: {
      channelId: z.string().optional().describe("Defaults to the authenticated user"),
      maxResults: z.number().int().min(1).max(50).default(25),
      pageToken: z.string().optional(),
    },
    handler: async (args, ctx) => {
      const res = await ctx.requireYouTube().playlists.list({
        part: ["snippet", "status", "contentDetails"],
        ...(args.channelId ? { channelId: args.channelId } : { mine: true }),
        maxResults: args.maxResults,
        pageToken: args.pageToken,
      });
      return json({
        nextPageToken: res.data.nextPageToken ?? undefined,
        items: (res.data.items ?? []).map(formatPlaylist),
      });
    },
  },
  {
    name: "list_playlist_items",
    title: "List playlist items",
    description:
      "List the videos in a playlist. Works with a channel's uploads playlist ID to page " +
      "through everything it has published.",
    readOnlyHint: true,
    inputSchema: {
      playlistId: z.string().min(1),
      maxResults: z.number().int().min(1).max(50).default(25),
      pageToken: z.string().optional(),
    },
    handler: async (args, ctx) => {
      const res = await ctx.requireYouTube().playlistItems.list({
        part: ["snippet", "contentDetails"],
        playlistId: args.playlistId,
        maxResults: args.maxResults,
        pageToken: args.pageToken,
      });
      return json({
        nextPageToken: res.data.nextPageToken ?? undefined,
        items: (res.data.items ?? []).map(formatPlaylistItem),
      });
    },
  },
  {
    name: "create_playlist",
    title: "Create a playlist",
    description: "Create a new playlist on the authenticated user's channel.",
    write: true,
    oauthOnly: true,
    inputSchema: {
      title: z.string().min(1).max(150),
      description: z.string().max(5000).default(""),
      privacyStatus: z.enum(["public", "unlisted", "private"]).default("private"),
    },
    handler: async (args, ctx) => {
      const youtube = await ctx.requireWrites("create_playlist", { title: args.title });
      const res = await youtube.playlists.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: { title: args.title, description: args.description },
          status: { privacyStatus: args.privacyStatus },
        },
      });
      await ctx.audit.record({
        tool: "create_playlist",
        outcome: "allowed",
        target: { playlistId: res.data.id, title: args.title },
      });
      return json({ created: true, playlist: formatPlaylist(res.data) });
    },
  },
  {
    name: "add_playlist_item",
    title: "Add a video to a playlist",
    description: "Append a video to a playlist, or insert it at a specific position.",
    write: true,
    oauthOnly: true,
    inputSchema: {
      playlistId: z.string().min(1),
      videoId: z.string().min(1),
      position: z.number().int().min(0).optional().describe("Zero-based; omit to append"),
    },
    handler: async (args, ctx) => {
      const target = { playlistId: args.playlistId, videoId: args.videoId };
      const youtube = await ctx.requireWrites("add_playlist_item", target);
      const res = await youtube.playlistItems.insert({
        part: ["snippet"],
        requestBody: {
          snippet: {
            playlistId: args.playlistId,
            resourceId: { kind: "youtube#video", videoId: args.videoId },
            ...(args.position !== undefined ? { position: args.position } : {}),
          },
        },
      });
      await ctx.audit.record({ tool: "add_playlist_item", outcome: "allowed", target });
      return json({ added: true, item: formatPlaylistItem(res.data) });
    },
  },
  {
    name: "remove_playlist_item",
    title: "Remove a video from a playlist",
    description:
      "Remove an entry from a playlist. Takes the playlistItemId (from 'list_playlist_items'), " +
      "not the video ID — the same video can appear more than once.",
    write: true,
    oauthOnly: true,
    destructiveHint: true,
    inputSchema: {
      playlistItemId: z
        .string()
        .min(1)
        .describe("The 'playlistItemId' field returned by list_playlist_items"),
    },
    handler: async (args, ctx) => {
      const target = { playlistItemId: args.playlistItemId };
      const youtube = await ctx.requireWrites("remove_playlist_item", target);
      if (!args.playlistItemId.trim()) {
        throw new ToolError("playlistItemId must not be blank.");
      }
      await youtube.playlistItems.delete({ id: args.playlistItemId });
      await ctx.audit.record({ tool: "remove_playlist_item", outcome: "allowed", target });
      return text(`Removed playlist item ${args.playlistItemId}.`);
    },
  },
];
