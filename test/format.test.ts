import { describe, it, expect } from "vitest";
import { humanDuration, formatVideo, formatAnalyticsReport } from "../src/lib/format.js";
import { srtToPlainText } from "../src/tools/captions.js";

describe("humanDuration", () => {
  it("renders ISO-8601 durations", () => {
    expect(humanDuration("PT4M13S")).toBe("4:13");
    expect(humanDuration("PT1H2M3S")).toBe("1:02:03");
    expect(humanDuration("PT45S")).toBe("0:45");
    expect(humanDuration("P1DT2H")).toBe("26:00:00");
  });
  it("passes through what it cannot parse", () => {
    expect(humanDuration(undefined)).toBeUndefined();
    expect(humanDuration("garbage")).toBe("garbage");
  });
});

describe("formatVideo", () => {
  const raw = {
    id: "abc123",
    etag: "should-be-dropped",
    snippet: {
      title: "Test",
      channelTitle: "Chan",
      description: "Desc",
      thumbnails: {
        default: { url: "d.jpg" },
        medium: { url: "m.jpg" },
        high: { url: "h.jpg" },
      },
    },
    statistics: { viewCount: "1234", likeCount: "56" },
    contentDetails: { duration: "PT2M" },
    status: { privacyStatus: "public" },
  };

  it("keeps the useful fields and drops API noise", () => {
    const out = formatVideo(raw) as Record<string, unknown>;
    expect(out.id).toBe("abc123");
    expect(out.title).toBe("Test");
    expect(out.url).toBe("https://www.youtube.com/watch?v=abc123");
    expect(out.duration).toBe("2:00");
    expect(out).not.toHaveProperty("etag");
  });

  it("converts count strings to numbers", () => {
    const out = formatVideo(raw) as Record<string, unknown>;
    expect(out.viewCount).toBe(1234);
    expect(out.likeCount).toBe(56);
  });

  it("collapses three thumbnail sizes into one URL", () => {
    expect((formatVideo(raw) as Record<string, unknown>).thumbnail).toBe("h.jpg");
  });

  it("survives a response with missing fields", () => {
    expect(() => formatVideo({})).not.toThrow();
    expect((formatVideo({}) as Record<string, unknown>).title).toBeUndefined();
  });
});

describe("formatAnalyticsReport", () => {
  it("turns column-oriented rows into objects", () => {
    const out = formatAnalyticsReport({
      columnHeaders: [{ name: "video" }, { name: "views" }],
      rows: [
        ["v1", 10],
        ["v2", 20],
      ],
    });
    expect(out.columns).toEqual(["video", "views"]);
    expect(out.rowCount).toBe(2);
    expect(out.rows[0]).toEqual({ video: "v1", views: 10 });
  });

  it("handles an empty report", () => {
    const out = formatAnalyticsReport({});
    expect(out.rowCount).toBe(0);
    expect(out.rows).toEqual([]);
  });
});

describe("srtToPlainText", () => {
  it("strips indices, timings and repeated cues", () => {
    const srt = [
      "1",
      "00:00:01,000 --> 00:00:03,000",
      "Hello there",
      "",
      "2",
      "00:00:03,000 --> 00:00:05,000",
      "Hello there",
      "",
      "3",
      "00:00:05,000 --> 00:00:07,000",
      "General Kenobi",
      "",
    ].join("\n");
    expect(srtToPlainText(srt)).toBe("Hello there General Kenobi");
  });
});
