import { describe, expect, it } from "vitest";
import {
  createGraphSnapshot,
  defaultAdapterConfig,
  normalizeFileToNote,
  resolveWikiTarget,
  type VaultFileInput
} from "../../src";

describe("generic vault adapter", () => {
  it("classifies numbered PARA roots and index/log/data roles", () => {
    expect(normalizeFileToNote(file("0. Common/index.md")).para).toBe("common");
    expect(normalizeFileToNote(file("1. Projects/demo/_index.md")).role).toBe("index");
    expect(normalizeFileToNote(file("1. Projects/demo/_log.md")).role).toBe("log");
    expect(normalizeFileToNote(file("3. Resources/topic/note.md", { type: "data" })).role).toBe("data");
    expect(normalizeFileToNote(file("Inbox/raw.md")).para).toBe("inbox");
  });

  it("normalizes notes and resolves links with measured or inferred confidence", () => {
    const files: VaultFileInput[] = [
      {
        path: "0. Common/index.md",
        stat: { ctime: 1, mtime: 2, size: 100 },
        frontmatter: { summary: "Hub", tags: ["hub"], aliases: "Home" },
        links: [{ link: "1. Projects/demo/_index" }, { link: "Topic" }, { link: "Missing Note" }]
      },
      file("1. Projects/demo/_index.md"),
      file("3. Resources/topic/Topic.md")
    ];

    const snapshot = createGraphSnapshot(files, "2026-08-05T00:00:00.000Z", {
      id: "vault",
      label: "Vault"
    });

    expect(snapshot.notes).toHaveLength(3);
    expect(snapshot.notes[0]).toMatchObject({
      id: "0. Common/index.md",
      para: "common",
      role: "index",
      tags: ["hub"],
      aliases: ["Home"],
      summary: "Hub"
    });
    expect(snapshot.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetPath: "1. Projects/demo/_index.md",
          resolved: true,
          confidence: "measured"
        }),
        expect.objectContaining({
          targetPath: "3. Resources/topic/Topic.md",
          resolved: true,
          confidence: "inferred"
        }),
        expect.objectContaining({
          targetPath: "Missing Note.md",
          resolved: false,
          confidence: "unavailable"
        })
      ])
    );
  });

  it("excludes configured private and runtime material from graph snapshots", () => {
    const config = {
      ...defaultAdapterConfig,
      exclusions: [...defaultAdapterConfig.exclusions, "Private/"]
    };
    const snapshot = createGraphSnapshot(
      [
        file("Private/journal.md"),
        file(".obsidian/plugins/llm-wiki-observatory/src/model.md"),
        file(".omx/plans/private.md"),
        file(".trash/deleted.md"),
        file("_resource/template/private.md"),
        file("2. Areas/idea/public.md")
      ],
      "2026-08-05T00:00:00.000Z",
      { id: "vault", label: "Vault", exclusions: config.exclusions },
      config
    );

    expect(snapshot.notes.map((note) => note.path)).toEqual(["2. Areas/idea/public.md"]);
  });

  it("does not infer-resolve duplicate basenames to an arbitrary first note", () => {
    const snapshot = createGraphSnapshot(
      [
        { ...file("0. Common/index.md"), links: [{ link: "Topic" }] },
        file("2. Areas/a/Topic.md"),
        file("3. Resources/b/Topic.md")
      ],
      "2026-08-05T00:00:00.000Z",
      { id: "vault", label: "Vault" }
    );

    expect(snapshot.links).toEqual([
      expect.objectContaining({
        targetPath: "Topic.md",
        resolved: false,
        confidence: "unavailable"
      })
    ]);
  });

  it("resolves empty wikilinks as unavailable rather than pretending they are zero-cost data", () => {
    const result = resolveWikiTarget("", new Map(), new Map());
    expect(result).toEqual({ path: "", confidence: "unavailable", resolved: false });
  });
});

function file(path: string, frontmatter: Record<string, unknown> = {}): VaultFileInput {
  return {
    path,
    frontmatter,
    stat: { ctime: 1, mtime: 1, size: 10 }
  };
}
