import type { ToolDefinition } from "./types.js";
import { authTools } from "./auth.js";
import { searchTools } from "./search.js";
import { videoTools } from "./videos.js";
import { channelTools } from "./channels.js";
import { playlistTools } from "./playlists.js";
import { commentTools } from "./comments.js";
import { captionTools } from "./captions.js";
import { analyticsTools } from "./analytics.js";

export const allTools: ToolDefinition[] = [
  ...authTools,
  ...searchTools,
  ...videoTools,
  ...channelTools,
  ...playlistTools,
  ...commentTools,
  ...captionTools,
  ...analyticsTools,
];

export type { ToolDefinition };
