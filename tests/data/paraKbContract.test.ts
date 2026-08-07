import { describe, expect, it } from "vitest";
import { groupQueryJourneys, parseTelemetryJsonl } from "../../src/usage/jsonl";
import { PARA_KB_V1_TELEMETRY_SCHEMA } from "../../src/plugin/profiles";
import buildFixture from "../fixtures/para-kb-v1/build-v1.jsonl?raw";
import queryFixture from "../fixtures/para-kb-v1/query-v1.jsonl?raw";

const FIXTURES: Record<string, string> = {
  "build-v1.jsonl": buildFixture,
  "query-v1.jsonl": queryFixture
};

describe("PARA Knowledge Base v1 contract fixtures", () => {
  it("keeps producer fixture checksums pinned", async () => {
    await expect(hash(fixture("query-v1.jsonl"))).resolves.toBe("e45b81c1e127ac603a5d9889aa95f4ed5acc04b0cd15b5e7deb99f135d9c5342");
    await expect(hash(fixture("build-v1.jsonl"))).resolves.toBe("6ffccd24bd966b96b21d8819aa8f610165417cbcf43b6d5e6ab5143db8a30517");
  });

  it("normalizes canonical query steps and request grouping", () => {
    const parsed = parseTelemetryJsonl(
      fixture("query-v1.jsonl"),
      "fixtures/para-kb-v1/query-v1.jsonl",
      PARA_KB_V1_TELEMETRY_SCHEMA
    );
    const journey = groupQueryJourneys(parsed)[0];
    expect(journey).toMatchObject({
      queryId: "query-synthetic-001",
      requestId: "request-synthetic-001",
      durationMs: { value: 9_000, confidence: "measured" },
      totalTokens: { value: 2_500, confidence: "measured" },
      completed: true
    });
    expect(journey?.steps).toEqual([
      expect.objectContaining({ toolName: "read", paths: ["1. Projects/alpha/_index.md"] })
    ]);
  });

  it("normalizes canonical Inbox build evidence", () => {
    const parsed = parseTelemetryJsonl(
      fixture("build-v1.jsonl"),
      "fixtures/para-kb-v1/build-v1.jsonl",
      PARA_KB_V1_TELEMETRY_SCHEMA
    );
    const journey = groupQueryJourneys(parsed)[0];
    expect(journey).toMatchObject({
      queryId: "build-synthetic-001",
      requestId: "request-synthetic-002",
      durationMs: { value: 21_000, confidence: "measured" },
      totalTokens: { value: 4_000, confidence: "measured" },
      buildSummary: {
        route: "kb-ingest",
        movedFromPaths: ["Inbox/Captured note.md"],
        movedToPaths: ["3. Resources/methods/Captured note.md"],
        validation: "passed"
      }
    });
    expect(journey?.steps).toHaveLength(2);
  });
});

function fixture(name: string): string {
  const value = FIXTURES[name];
  if (value === undefined) throw new Error(`Unknown fixture: ${name}`);
  return value;
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
