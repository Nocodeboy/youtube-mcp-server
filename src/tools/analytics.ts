import { z } from "zod";
import { formatAnalyticsReport } from "../lib/format.js";
import { json } from "../lib/result.js";
import { ToolError } from "../lib/errors.js";
import type { ToolDefinition } from "./types.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
  .describe("YYYY-MM-DD");

const CORE_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "subscribersGained",
  "subscribersLost",
  "likes",
  "dislikes",
  "comments",
  "shares",
] as const;

/** Guard against a reversed range, which the API rejects with an unhelpful 400. */
function assertRange(startDate: string, endDate: string): void {
  if (startDate > endDate) {
    throw new ToolError(`startDate (${startDate}) is after endDate (${endDate}).`);
  }
}

const dateRange = { startDate: isoDate, endDate: isoDate };

export const analyticsTools: ToolDefinition[] = [
  {
    name: "analytics_channel_summary",
    title: "Channel analytics summary",
    description:
      "Headline metrics for the authorized channel over a date range, optionally broken down " +
      "by day or month. Read-only; covers your own channel only.",
    readOnlyHint: true,
    oauthOnly: true,
    inputSchema: {
      ...dateRange,
      granularity: z.enum(["total", "day", "month"]).default("total"),
    },
    handler: async (args, ctx) => {
      assertRange(args.startDate, args.endDate);
      const res = await ctx.requireAnalytics().reports.query({
        ids: "channel==MINE",
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: CORE_METRICS.join(","),
        ...(args.granularity === "total" ? {} : { dimensions: args.granularity }),
        ...(args.granularity === "total" ? {} : { sort: args.granularity }),
      });
      return json(formatAnalyticsReport(res.data));
    },
  },
  {
    name: "analytics_top_videos",
    title: "Top videos by metric",
    description: "Rank the channel's videos by a metric over a date range. Read-only.",
    readOnlyHint: true,
    oauthOnly: true,
    inputSchema: {
      ...dateRange,
      metric: z
        .enum([
          "views",
          "estimatedMinutesWatched",
          "averageViewDuration",
          "averageViewPercentage",
          "subscribersGained",
          "likes",
          "comments",
          "shares",
        ])
        .default("views"),
      limit: z.number().int().min(1).max(200).default(10),
    },
    handler: async (args, ctx) => {
      assertRange(args.startDate, args.endDate);
      const res = await ctx.requireAnalytics().reports.query({
        ids: "channel==MINE",
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: [args.metric, "views", "estimatedMinutesWatched"]
          .filter((m, i, a) => a.indexOf(m) === i)
          .join(","),
        dimensions: "video",
        sort: `-${args.metric}`,
        maxResults: args.limit,
      });

      const report = formatAnalyticsReport(res.data);
      // Analytics identifies videos by ID only, which is unreadable on its own. One extra
      // videos.list call (1 quota unit) turns the report into something a human can scan.
      const ids = report.rows
        .map((r) => (r as Record<string, unknown>).video)
        .filter((v): v is string => typeof v === "string")
        .slice(0, 50);

      if (ids.length > 0) {
        try {
          const details = await ctx.requireYouTube().videos.list({ part: ["snippet"], id: ids });
          const titles = new Map(
            (details.data.items ?? []).map((v) => [v.id, v.snippet?.title] as const),
          );
          report.rows = report.rows.map((row) => {
            const r = row as Record<string, unknown>;
            const id = typeof r.video === "string" ? r.video : undefined;
            return {
              ...r,
              title: id ? (titles.get(id) ?? "(unavailable)") : undefined,
              url: id ? `https://www.youtube.com/watch?v=${id}` : undefined,
            };
          });
        } catch {
          // Titles are a nicety; a failure here must not lose the analytics data.
        }
      }
      return json(report);
    },
  },
  {
    name: "analytics_video_metrics",
    title: "Metrics for one video",
    description:
      "Metrics for a single video over a date range, optionally broken down by day. Read-only.",
    readOnlyHint: true,
    oauthOnly: true,
    inputSchema: {
      videoId: z.string().min(1),
      ...dateRange,
      metrics: z
        .array(z.enum(CORE_METRICS))
        .min(1)
        .optional()
        .describe("Defaults to views, watch time, average duration and subscribers gained"),
      granularity: z.enum(["total", "day"]).default("total"),
    },
    handler: async (args, ctx) => {
      assertRange(args.startDate, args.endDate);
      const metrics = args.metrics ?? [
        "views",
        "estimatedMinutesWatched",
        "averageViewDuration",
        "subscribersGained",
      ];
      const res = await ctx.requireAnalytics().reports.query({
        ids: "channel==MINE",
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: metrics.join(","),
        filters: `video==${args.videoId}`,
        ...(args.granularity === "day" ? { dimensions: "day", sort: "day" } : {}),
      });
      return json({ videoId: args.videoId, ...formatAnalyticsReport(res.data) });
    },
  },
  {
    name: "analytics_traffic_sources",
    title: "Traffic sources",
    description:
      "Where views came from (search, suggested, external, browse...) over a date range, for " +
      "the channel or one video. Read-only.",
    readOnlyHint: true,
    oauthOnly: true,
    inputSchema: {
      ...dateRange,
      videoId: z.string().optional().describe("Omit for the whole channel"),
    },
    handler: async (args, ctx) => {
      assertRange(args.startDate, args.endDate);
      const res = await ctx.requireAnalytics().reports.query({
        ids: "channel==MINE",
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: "views,estimatedMinutesWatched",
        dimensions: "insightTrafficSourceType",
        sort: "-views",
        ...(args.videoId ? { filters: `video==${args.videoId}` } : {}),
      });
      return json(formatAnalyticsReport(res.data));
    },
  },
  {
    name: "analytics_demographics",
    title: "Audience demographics",
    description:
      "Viewer age and gender split over a date range, as a percentage of views. Read-only.",
    readOnlyHint: true,
    oauthOnly: true,
    inputSchema: {
      ...dateRange,
      videoId: z.string().optional().describe("Omit for the whole channel"),
    },
    handler: async (args, ctx) => {
      assertRange(args.startDate, args.endDate);
      const res = await ctx.requireAnalytics().reports.query({
        ids: "channel==MINE",
        startDate: args.startDate,
        endDate: args.endDate,
        metrics: "viewerPercentage",
        dimensions: "ageGroup,gender",
        sort: "-viewerPercentage",
        ...(args.videoId ? { filters: `video==${args.videoId}` } : {}),
      });
      return json(formatAnalyticsReport(res.data));
    },
  },
];
