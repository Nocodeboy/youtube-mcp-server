/**
 * Compact projections of YouTube API responses.
 *
 * The raw API reply carries `etag`, `kind`, per-item `kind`, and three thumbnail variants with
 * long URLs for every result. Handing that straight to a model burns thousands of tokens on
 * fields it never reads, so every tool returns a projection instead. `thumbnail` keeps a single
 * URL, which is all that is needed to show or re-fetch an image.
 */

type Snippet = {
  title?: string | null;
  description?: string | null;
  channelId?: string | null;
  channelTitle?: string | null;
  publishedAt?: string | null;
  tags?: string[] | null;
  thumbnails?: Record<string, { url?: string | null } | undefined> | null;
};

function pickThumbnail(snippet: Snippet | undefined): string | undefined {
  const t = snippet?.thumbnails;
  return t?.high?.url ?? t?.medium?.url ?? t?.default?.url ?? undefined;
}

/** ISO-8601 duration (PT4M13S) into something a model can compare without parsing. */
export function humanDuration(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return iso;
  const [, d, h, min, s] = m.map((v) => (v ? Number(v) : 0)) as unknown as number[];
  const total = (d ?? 0) * 86400 + (h ?? 0) * 3600 + (min ?? 0) * 60 + (s ?? 0);
  if (total === 0) return iso;
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

function num(v: string | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function formatSearchResult(item: any) {
  const id = item?.id?.videoId ?? item?.id?.channelId ?? item?.id?.playlistId;
  const kind: string = item?.id?.kind ?? "";
  return {
    id,
    type: kind.replace("youtube#", "") || undefined,
    title: item?.snippet?.title,
    channelTitle: item?.snippet?.channelTitle,
    channelId: item?.snippet?.channelId,
    publishedAt: item?.snippet?.publishedAt,
    description: item?.snippet?.description,
    url: item?.id?.videoId
      ? `https://www.youtube.com/watch?v=${item.id.videoId}`
      : item?.id?.channelId
        ? `https://www.youtube.com/channel/${item.id.channelId}`
        : undefined,
    thumbnail: pickThumbnail(item?.snippet),
  };
}

export function formatVideo(item: any) {
  return {
    id: item?.id,
    title: item?.snippet?.title,
    channelTitle: item?.snippet?.channelTitle,
    channelId: item?.snippet?.channelId,
    publishedAt: item?.snippet?.publishedAt,
    description: item?.snippet?.description,
    tags: item?.snippet?.tags ?? undefined,
    categoryId: item?.snippet?.categoryId,
    duration: humanDuration(item?.contentDetails?.duration),
    privacyStatus: item?.status?.privacyStatus,
    madeForKids: item?.status?.madeForKids,
    viewCount: num(item?.statistics?.viewCount),
    likeCount: num(item?.statistics?.likeCount),
    commentCount: num(item?.statistics?.commentCount),
    url: item?.id ? `https://www.youtube.com/watch?v=${item.id}` : undefined,
    thumbnail: pickThumbnail(item?.snippet),
  };
}

export function formatChannel(item: any) {
  return {
    id: item?.id,
    title: item?.snippet?.title,
    customUrl: item?.snippet?.customUrl,
    description: item?.snippet?.description,
    publishedAt: item?.snippet?.publishedAt,
    country: item?.snippet?.country,
    subscriberCount: num(item?.statistics?.subscriberCount),
    hiddenSubscriberCount: item?.statistics?.hiddenSubscriberCount,
    videoCount: num(item?.statistics?.videoCount),
    viewCount: num(item?.statistics?.viewCount),
    uploadsPlaylistId: item?.contentDetails?.relatedPlaylists?.uploads,
    url: item?.snippet?.customUrl
      ? `https://www.youtube.com/${item.snippet.customUrl}`
      : item?.id
        ? `https://www.youtube.com/channel/${item.id}`
        : undefined,
    thumbnail: pickThumbnail(item?.snippet),
  };
}

export function formatPlaylist(item: any) {
  return {
    id: item?.id,
    title: item?.snippet?.title,
    description: item?.snippet?.description,
    channelTitle: item?.snippet?.channelTitle,
    publishedAt: item?.snippet?.publishedAt,
    privacyStatus: item?.status?.privacyStatus,
    itemCount: item?.contentDetails?.itemCount,
    url: item?.id ? `https://www.youtube.com/playlist?list=${item.id}` : undefined,
  };
}

export function formatPlaylistItem(item: any) {
  const videoId = item?.contentDetails?.videoId ?? item?.snippet?.resourceId?.videoId;
  return {
    playlistItemId: item?.id,
    videoId,
    title: item?.snippet?.title,
    channelTitle: item?.snippet?.videoOwnerChannelTitle ?? item?.snippet?.channelTitle,
    position: item?.snippet?.position,
    publishedAt: item?.contentDetails?.videoPublishedAt ?? item?.snippet?.publishedAt,
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined,
  };
}

export function formatCommentThread(item: any) {
  const top = item?.snippet?.topLevelComment?.snippet;
  return {
    commentId: item?.snippet?.topLevelComment?.id,
    threadId: item?.id,
    author: top?.authorDisplayName,
    authorChannelId: top?.authorChannelId?.value,
    text: top?.textOriginal ?? top?.textDisplay,
    likeCount: top?.likeCount,
    publishedAt: top?.publishedAt,
    updatedAt: top?.updatedAt,
    totalReplyCount: item?.snippet?.totalReplyCount,
    replies: (item?.replies?.comments ?? []).map((r: any) => ({
      commentId: r?.id,
      author: r?.snippet?.authorDisplayName,
      text: r?.snippet?.textOriginal ?? r?.snippet?.textDisplay,
      publishedAt: r?.snippet?.publishedAt,
    })),
  };
}

/** Analytics replies are column-oriented; rows of objects are far easier for a model to read. */
export function formatAnalyticsReport(data: any) {
  const headers: string[] = (data?.columnHeaders ?? []).map((h: any) => h?.name ?? "unknown");
  const rows: unknown[][] = data?.rows ?? [];
  return {
    columns: headers,
    rowCount: rows.length,
    rows: rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]]))),
  };
}
