import { describe, expect, it } from "vitest";
import { ObsidianAdapterSnapshotStorage } from "../../src/obsidian/adapter-storage";
import type { ObservatoryAdapter } from "../../src/obsidian/types";

describe("ObsidianAdapterSnapshotStorage", () => {
  it("returns an empty list only when the snapshot root is known to be absent", async () => {
    const storage = new ObsidianAdapterSnapshotStorage(adapter({ exists: async () => false }));

    await expect(storage.listFiles("snapshots")).resolves.toEqual([]);
  });

  it("propagates adapter existence failures instead of masking them as an empty repository", async () => {
    const storage = new ObsidianAdapterSnapshotStorage(adapter({
      exists: async () => {
        throw new Error("adapter offline");
      }
    }));

    await expect(storage.listFiles("snapshots")).rejects.toThrow("adapter offline");
  });

  it("propagates recursive listing failures for the service warning boundary", async () => {
    const storage = new ObsidianAdapterSnapshotStorage(adapter({
      exists: async () => true,
      list: async () => {
        throw new Error("list denied");
      }
    }));

    await expect(storage.listFiles("snapshots")).rejects.toThrow("list denied");
  });
});

function adapter(overrides: Partial<ObservatoryAdapter>): ObservatoryAdapter {
  return {
    exists: async () => false,
    read: async () => "",
    write: async () => undefined,
    mkdir: async () => undefined,
    list: async () => ({ files: [], folders: [] }),
    ...overrides
  };
}
