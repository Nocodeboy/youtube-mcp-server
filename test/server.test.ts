import { describe, it, expect } from "vitest";
import { selectTools } from "../src/server.js";
import { allTools } from "../src/tools/index.js";

const names = (opts: { allowWrites: boolean; enableCaptions: boolean }) =>
  selectTools(allTools, opts).map((t) => t.name);

describe("tool exposure", () => {
  it("hides every mutating tool when writes are disabled", () => {
    const exposed = names({ allowWrites: false, enableCaptions: false });
    for (const tool of allTools.filter((t) => t.write)) {
      expect(exposed, `${tool.name} must not be advertised`).not.toContain(tool.name);
    }
    expect(exposed).toContain("search_videos");
    expect(exposed).toContain("auth_status");
  });

  it("exposes mutating tools once writes are enabled", () => {
    const exposed = names({ allowWrites: true, enableCaptions: false });
    expect(exposed).toContain("update_video");
    expect(exposed).toContain("reply_to_comment");
    expect(exposed).toContain("set_thumbnail");
  });

  it("keeps caption tools behind their own flag", () => {
    expect(names({ allowWrites: true, enableCaptions: false })).not.toContain("get_transcript");
    expect(names({ allowWrites: false, enableCaptions: true })).toContain("get_transcript");
  });

  it("marks destructive tools so clients can warn", () => {
    const remove = allTools.find((t) => t.name === "remove_playlist_item");
    expect(remove?.destructiveHint).toBe(true);
  });

  it("gives every tool a unique name and a description", () => {
    const seen = new Set<string>();
    for (const tool of allTools) {
      expect(seen.has(tool.name), `duplicate tool name: ${tool.name}`).toBe(false);
      seen.add(tool.name);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.title.length).toBeGreaterThan(0);
    }
  });

  it("flags every mutating tool as requiring OAuth", () => {
    for (const tool of allTools.filter((t) => t.write)) {
      expect(tool.oauthOnly, `${tool.name} should be oauthOnly`).toBe(true);
      expect(tool.readOnlyHint ?? false).toBe(false);
    }
  });
});
