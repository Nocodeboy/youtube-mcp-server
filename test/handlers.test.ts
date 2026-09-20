import { describe, it, expect, vi } from "vitest";
import { allTools } from "../src/tools/index.js";
import type { YouTubeContext } from "../src/context.js";

const tool = (name: string) => {
  const found = allTools.find((t) => t.name === name);
  if (!found) throw new Error(`no such tool: ${name}`);
  return found;
};

const textOf = (result: { content: unknown }) =>
  (result.content as Array<{ text: string }>)[0]!.text;

/** Minimal stand-in for YouTubeContext, so handlers can be driven without network or OAuth. */
function fakeContext(api: {
  videosList?: ReturnType<typeof vi.fn>;
  videosUpdate?: ReturnType<typeof vi.fn>;
  analyticsQuery?: ReturnType<typeof vi.fn>;
}) {
  const youtube = {
    videos: {
      list: api.videosList ?? vi.fn(),
      update: api.videosUpdate ?? vi.fn().mockResolvedValue({ data: {} }),
    },
  };
  const record = vi.fn().mockResolvedValue(undefined);
  return {
    ctx: {
      config: { allowWrites: true, enableCaptions: false },
      audit: { record },
      authMode: "oauth",
      requireYouTube: () => youtube,
      requireWrites: async () => youtube,
      requireAnalytics: () => ({ reports: { query: api.analyticsQuery ?? vi.fn() } }),
    } as unknown as YouTubeContext,
    youtube,
    record,
  };
}

describe("update_video", () => {
  const video = {
    id: "v1",
    snippet: { title: "Old", description: "Desc", categoryId: "22", tags: ["a", "b"] },
    status: { privacyStatus: "public" },
  };
  const listing = vi.fn().mockResolvedValue({ data: { items: [video] } });

  it("does not spend quota re-sending identical tags", async () => {
    const { ctx, youtube } = fakeContext({ videosList: listing });
    const result = await tool("update_video").handler(
      { videoId: "v1", tags: ["a", "b"], dryRun: false },
      ctx,
    );
    expect(textOf(result)).toMatch(/No changes/);
    expect(youtube.videos.update).not.toHaveBeenCalled();
  });

  it("updates when the tags genuinely differ", async () => {
    const { ctx, youtube } = fakeContext({ videosList: listing });
    await tool("update_video").handler(
      { videoId: "v1", tags: ["a", "c"], dryRun: false },
      ctx,
    );
    expect(youtube.videos.update).toHaveBeenCalledOnce();
  });

  it("clears the description when given an empty string", async () => {
    const { ctx, youtube } = fakeContext({ videosList: listing });
    await tool("update_video").handler({ videoId: "v1", description: "", dryRun: false }, ctx);

    const body = youtube.videos.update.mock.calls[0]![0].requestBody;
    expect(body.snippet.description).toBe("");
    expect(body.snippet.categoryId).toBe("22"); // required by the API, easy to drop
  });

  it("omits the status part unless privacy was requested", async () => {
    const { ctx, youtube } = fakeContext({ videosList: listing });
    await tool("update_video").handler({ videoId: "v1", title: "New", dryRun: false }, ctx);

    const call = youtube.videos.update.mock.calls[0]![0];
    expect(call.part).toEqual(["snippet"]);
    expect(call.requestBody.status).toBeUndefined();
  });

  it("changes nothing on a dry run", async () => {
    const { ctx, youtube } = fakeContext({ videosList: listing });
    const result = await tool("update_video").handler(
      { videoId: "v1", title: "New", dryRun: true },
      ctx,
    );
    expect(youtube.videos.update).not.toHaveBeenCalled();
    expect(JSON.parse(textOf(result)).dryRun).toBe(true);
  });
});

describe("get_video_details", () => {
  it("reports missing IDs instead of returning a bare empty list", async () => {
    const { ctx } = fakeContext({
      videosList: vi.fn().mockResolvedValue({ data: { items: [] } }),
    });
    await expect(
      tool("get_video_details").handler({ videoIds: ["nope"] }, ctx),
    ).rejects.toThrow(/No videos found/);
  });

  it("names the IDs that were not returned", async () => {
    const { ctx } = fakeContext({
      videosList: vi.fn().mockResolvedValue({ data: { items: [{ id: "a", snippet: {} }] } }),
    });
    const out = JSON.parse(
      textOf(await tool("get_video_details").handler({ videoIds: ["a", "b"] }, ctx)),
    );
    expect(out.notFound).toEqual(["b"]);
  });
});

describe("analytics_top_videos", () => {
  it("resolves titles for every row, not just the first fifty", async () => {
    // 60 rows forces a second videos.list page; the first version sliced to 50 and then
    // labelled rows 51-60 "(unavailable)", implying those videos were deleted.
    const ids = Array.from({ length: 60 }, (_, i) => `vid${i}`);
    const analyticsQuery = vi.fn().mockResolvedValue({
      data: {
        columnHeaders: [{ name: "video" }, { name: "views" }],
        rows: ids.map((id, i) => [id, 100 - i]),
      },
    });
    const videosList = vi.fn().mockImplementation(async ({ id }: { id: string[] }) => ({
      data: { items: id.map((x) => ({ id: x, snippet: { title: `Title ${x}` } })) },
    }));

    const { ctx } = fakeContext({ analyticsQuery, videosList });
    const out = JSON.parse(
      textOf(
        await tool("analytics_top_videos").handler(
          { startDate: "2026-01-01", endDate: "2026-01-31", metric: "views", limit: 200 },
          ctx,
        ),
      ),
    );

    expect(videosList).toHaveBeenCalledTimes(2);
    expect(out.rows).toHaveLength(60);
    expect(out.rows[59].title).toBe("Title vid59");
    expect(out.rows.some((r: { title?: string }) => r.title === "(unavailable)")).toBe(false);
  });

  it("keeps the report when the title lookup fails", async () => {
    const { ctx } = fakeContext({
      analyticsQuery: vi.fn().mockResolvedValue({
        data: { columnHeaders: [{ name: "video" }], rows: [["v1"]] },
      }),
      videosList: vi.fn().mockRejectedValue(new Error("quota")),
    });
    const out = JSON.parse(
      textOf(
        await tool("analytics_top_videos").handler(
          { startDate: "2026-01-01", endDate: "2026-01-31", metric: "views", limit: 10 },
          ctx,
        ),
      ),
    );
    expect(out.rows).toHaveLength(1);
  });

  it("rejects a reversed date range before calling the API", async () => {
    const analyticsQuery = vi.fn();
    const { ctx } = fakeContext({ analyticsQuery });
    await expect(
      tool("analytics_top_videos").handler(
        { startDate: "2026-03-01", endDate: "2026-01-01", metric: "views", limit: 10 },
        ctx,
      ),
    ).rejects.toThrow(/is after/);
    expect(analyticsQuery).not.toHaveBeenCalled();
  });
});
