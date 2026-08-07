import { describe, expect, it } from "vitest";
import {
  diffSnapshots,
  InMemorySnapshotStorage,
  SnapshotRepository,
  type GraphSnapshot
} from "../../src";

describe("snapshot diff and repository", () => {
  it("computes note and link deltas without conflating unresolved links with zero", () => {
    const before = snapshot("before", ["A.md"], [["A.md", "Missing.md", false]]);
    const after = snapshot("after", ["A.md", "B.md"], [["A.md", "B.md", true]]);

    const diff = diffSnapshots(before, after);

    expect(diff.addedNotes.map((note) => note.path)).toEqual(["B.md"]);
    expect(diff.removedNotes).toHaveLength(0);
    expect(diff.addedLinks).toEqual([expect.objectContaining({ targetPath: "B.md", resolved: true })]);
    expect(diff.removedLinks).toEqual([expect.objectContaining({ targetPath: "Missing.md", resolved: false })]);
    expect(diff.metrics).toEqual({
      noteDelta: 1,
      linkDelta: 0,
      resolvedLinkDelta: 1,
      unresolvedLinkDelta: -1
    });
  });

  it("stores snapshots under plugin-local paths through an abstract storage interface", async () => {
    const storage = new InMemorySnapshotStorage();
    const repository = new SnapshotRepository(storage);
    const path = await repository.save(snapshot("one", ["A.md"], []));

    expect(path).toBe(".obsidian/plugins/llm-wiki-observatory/snapshots/vault/2026-08-05T00-00-00.000Z.json");
    await expect(repository.list()).resolves.toEqual([path]);
    await expect(repository.load(path)).resolves.toMatchObject({ id: "one" });
  });

  it("rejects incompatible snapshot definition versions and scopes", () => {
    expect(() => diffSnapshots(snapshot("before", ["A.md"], []), {
      ...snapshot("after", ["A.md"], []),
      definitionVersion: "other"
    })).toThrow(/definitionVersion/);

    expect(() => diffSnapshots(snapshot("before", ["A.md"], []), {
      ...snapshot("after", ["A.md"], []),
      scope: { id: "different", label: "Different" }
    })).toThrow(/scope id/);
  });
});

function snapshot(
  id: string,
  notes: string[],
  links: Array<[string, string, boolean]>
): GraphSnapshot {
  return {
    id,
    definitionVersion: "test",
    observedAt: "2026-08-05T00:00:00.000Z",
    scope: { id: "vault", label: "Vault" },
    notes: notes.map((path) => ({
      id: path,
      path,
      title: path.replace(".md", ""),
      para: "unknown",
      role: "content",
      tags: [],
      aliases: [],
      summary: null,
      sizeBytes: null,
      createdTime: null,
      modifiedTime: null,
      confidence: "measured"
    })),
    links: links.map(([sourcePath, targetPath, resolved]) => ({
      id: `${sourcePath}->${targetPath}`,
      sourceId: sourcePath,
      targetId: targetPath,
      sourcePath,
      targetPath,
      resolved,
      confidence: resolved ? "measured" : "unavailable"
    })),
    metrics: []
  };
}
