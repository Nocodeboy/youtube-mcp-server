import { z } from "zod";
import { formatSearchResult } from "../lib/format.js";
import { json } from "../lib/result.js";
import type { ToolDefinition } from "./types.js";

const QUOTA_NOTE = "Costs 100 quota units per call out of a 10,000/day default budget.";

const common = {
  query: z.string().min(1).describe("Search terms"),
  maxResults: z.number().int().min(1).max(50).default(10),
  pageToken: z.string().optional().describe("Token from a previous response's nextPageToken"),
};

const order = z
  .enum(["relevance", "date", "rating", "title", "viewCount"])
  .default("relevance");

export const searchTools: ToolDefinition[] = [
  {
    name: "search_videos",
    title: "Search videos",
    description: `Search YouTube for videos. ${QUOTA_NOTE}`,
    readOnlyHint: true,
    inputSchema: {
      ...common,
      order,
      publishedAfter: z
        .string()
        .datetime()
        .optional()
        .describe("RFC 3339 timestamp, e.g. 2026-01-01T00:00:00Z"),
      channelId: z.string().optional().describe("Restrict results to one channel"),
    },
    handler: async (args, ctx) => {
      const res = await ctx.requireYouTube().search.list({
        part: ["snippet"],
        q: args.query,
        type: ["video"],
        maxResults: args.maxResults,
        order: args.order,
        pageToken: args.pageToken,
        publishedAfter: args.publishedAfter,
        channelId: args.channelId,
      });
      return json({
        totalResults: res.data.pageInfo?.totalResults,
        nextPageToken: res.data.nextPageToken ?? undefined,
        items: (res.data.items ?? []).map(formatSearchResult),
      });
    },
  },
  {
    name: "search_channels",
    title: "Search channels",
    description: `Search YouTube for channels. ${QUOTA_NOTE}`,
    readOnlyHint: true,
    inputSchema: { ...common, order },
    handler: async (args, ctx) => {
      const res = await ctx.requireYouTube().search.list({
        part: ["snippet"],
        q: args.query,
        type: ["channel"],
        maxResults: args.maxResults,
        order: args.order,
        pageToken: args.pageToken,
      });
      return json({
        totalResults: res.data.pageInfo?.totalResults,
        nextPageToken: res.data.nextPageToken ?? undefined,
        items: (res.data.items ?? []).map(formatSearchResult),
      });
    },
  },
];
