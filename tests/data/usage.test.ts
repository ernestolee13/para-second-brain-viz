import { describe, expect, it } from "vitest";
import {
  aggregateLensUiUsage,
  aggregateLensUsage,
  groupQueryJourneys,
  parseTelemetryJsonl,
  stableHash
} from "../../src";
import { GENERIC_JSONL_TELEMETRY_SCHEMA } from "../../src/plugin/profiles";

describe("query telemetry usage layer", () => {
  it("groups explicit kb-query operations separately from their parent turn and never retains prompt/query text", () => {
    const source = "0. Common/query-telemetry.jsonl";
    const text = [
      JSON.stringify({
        cwd: ".",
        event: "UserPromptSubmit",
        prompt_chars: 51,
        prompt_command: null,
        prompt_hash: "redacted-hash",
        query_id: "turn-redacted",
        session_id: "session-redacted",
        source: "codex-hook",
        timestamp: "2026-08-05T10:06:24+09:00",
        vault_hint: false,
        prompt: "PRIVATE PROMPT SHOULD NOT SURVIVE"
      }),
      "{not-json",
      JSON.stringify({
        event: "QueryStart",
        operation_id: "query-redacted",
        operation_kind: "query",
        query_id: "turn-redacted",
        session_id: "session-redacted",
        source: "kb-query-skill",
        timestamp: "2026-08-05T10:06:25+09:00"
      }),
      JSON.stringify({
        command_class: "read-or-list",
        command_executable: "sed",
        command_vault_paths: ["1. Projects/demo/_index.md"],
        output_vault_paths: ["1. Projects/demo/spec.md"],
        duration_ms: null,
        event: "PostToolUse",
        estimated_input_tokens: 48,
        estimated_output_tokens: 250,
        query_id: "turn-redacted",
        operation_id: "query-redacted",
        session_id: "session-redacted",
        source: "codex-hook",
        timestamp: "2026-08-05T10:06:40+09:00",
        tool_name: "Bash",
        vault_paths: ["0. Common/index.md"]
      }),
      JSON.stringify({
        confidence: "medium",
        documents_read_count_auto: 6,
        documents_read_paths_auto: ["CLAUDE.md", "1. Projects/demo/_index.md", "0. Common/log.md"],
        entrypoints_auto: ["CLAUDE.md"],
        event: "AutoPathSummary",
        query_id: "turn-redacted",
        search_step_count_auto: 3,
        session_id: "session-redacted",
        source: "codex-hook",
        timestamp: "2026-08-05T10:07:00+09:00"
      }),
      JSON.stringify({
        comparison_group: null,
        confidence: "high",
        documents_read_count: 2,
        documents_read_paths: ["1. Projects/demo/final.md", "3. Resources/topic/Note.md"],
        entrypoints: ["1. Projects/demo/_index.md"],
        event: "QuerySummary",
        kb_query_used: true,
        query: "PRIVATE QUERY SHOULD NOT SURVIVE",
        query_id: "turn-redacted",
        operation_id: "query-redacted",
        operation_elapsed_ms: 9_600,
        request_type: "lookup",
        route: ["A:direct-folder", "E:full-text-search"],
        search_step_count: 1,
        session_id: "session-redacted",
        source: "kb-query-skill",
        summary_schema_version: 3,
        timestamp: "2026-08-05T10:07:07+09:00"
      }),
      JSON.stringify({
        event: "QueryComplete",
        operation_id: "query-redacted",
        operation_kind: "query",
        operation_elapsed_ms: 9_870,
        query_id: "turn-redacted",
        session_id: "session-redacted",
        timestamp: "2026-08-05T10:07:08+09:00",
        token_is_operation_delta: true,
        token_reliability: "high",
        token_total_for_analysis: 4_500
      }),
      JSON.stringify({
        elapsed_ms: 737_200,
        turn_elapsed_ms: 737_200,
        event: "Stop",
        input_tokens: 717091,
        output_tokens: 3274,
        query_id: "turn-redacted",
        session_id: "session-redacted",
        source: "codex-hook",
        timestamp: "2026-08-05T10:07:38+09:00",
        token_is_request_delta: true,
        token_reliability: "high",
        token_total_for_analysis: 720365,
        total_reported_tokens: 720365,
        usage: { input_tokens: 717091, output_tokens: 3274, total_tokens: 720365 }
      })
    ].join("\n");

    const parsed = parseTelemetryJsonl(text, source);
    const journeys = groupQueryJourneys(parsed);
    const query = journeys.find((journey) => journey.queryId === "query-redacted");
    const parentTurn = journeys.find((journey) => journey.queryId === "turn-redacted");

    expect(parsed.filter((line) => line.malformed)).toHaveLength(1);
    expect(journeys).toHaveLength(2);
    expect(query).toMatchObject({
      queryId: "query-redacted",
      requestId: "turn-redacted",
      sessionId: "session-redacted",
      completed: true,
      completionConfidence: "measured",
      tools: ["Bash"],
      documentsReadPaths: ["1. Projects/demo/final.md", "3. Resources/topic/Note.md"],
      entrypoints: ["1. Projects/demo/_index.md"]
    });
    expect(query?.accessedPaths).toEqual(["1. Projects/demo/final.md", "3. Resources/topic/Note.md"]);
    expect(query?.steps).toEqual([
      expect.objectContaining({
        index: 0,
        paths: ["0. Common/index.md", "1. Projects/demo/_index.md", "1. Projects/demo/spec.md"]
      })
    ]);
    expect(query?.durationMs).toEqual({
      value: 9_870,
      confidence: "measured",
      source: "QueryComplete.operation_elapsed_ms"
    });
    expect(query?.totalTokens).toEqual({
      value: 4_500,
      confidence: "measured",
      source: "QueryComplete.token_total_for_analysis"
    });
    expect(query?.documentsReadCount).toEqual({
      value: 2,
      confidence: "measured",
      source: "QuerySummary.documents_read_count"
    });
    expect(query?.searchStepCount).toEqual({
      value: 1,
      confidence: "measured",
      source: "QuerySummary.search_step_count"
    });
    expect(parentTurn?.durationMs.value).toBeNull();
    expect(parentTurn?.totalTokens.value).toBeNull();
    expect(parentTurn?.events.find((event) => event.kind === "Stop")?.durationMs).toEqual({
      value: 737_200,
      confidence: "measured",
      source: "Stop.turn_elapsed_ms"
    });
    expect(JSON.stringify(journeys)).not.toContain("PRIVATE");
  });

  it("keeps Stop timing and token totals out of query/build operation metrics", () => {
    const parsed = parseTelemetryJsonl(
      JSON.stringify({
        event: "Stop",
        elapsed_ms: 557307,
        query_id: "q-low",
        session_id: "s1",
        source: "codex-hook",
        timestamp: "2026-08-05T13:33:10+09:00",
        token_is_request_delta: false,
        token_reliability: "low",
        token_total_for_analysis: null,
        total_reported_tokens: 2588637,
        usage: { total_tokens: 2588637 }
      }),
      "0. Common/query-telemetry.jsonl"
    );

    const journey = groupQueryJourneys(parsed)[0];
    expect(journey?.totalTokens).toEqual({ value: null, confidence: "unavailable", source: "operation.token_total_for_analysis" });
    expect(journey?.durationMs).toEqual({ value: null, confidence: "unavailable", source: "operation.operation_elapsed_ms" });
    expect(journey?.events[0]?.durationMs).toEqual({ value: 557307, confidence: "measured", source: "Stop.turn_elapsed_ms" });
  });

  it("joins a privacy-preserving BuildSummary to its exact BuildComplete operation", () => {
    const parsed = parseTelemetryJsonl(
      [
        JSON.stringify({
          event: "BuildStart",
          query_id: "build-turn-1",
          operation_id: "ingest-op-1",
          operation_kind: "ingest",
          timestamp: "2026-08-06T10:00:00.000+09:00"
        }),
        JSON.stringify({
          event: "BuildSummary",
          query_id: "build-turn-1",
          operation_id: "ingest-op-1",
          operation_elapsed_ms: 45_000,
          timestamp: "2026-08-06T10:00:45.000+09:00",
          summary_schema_version: 2,
          operation_type: "create",
          route: "kb-ingest",
          kb_ingest_used: true,
          reference_paths: ["3. Resources/topic/Source.md"],
          created_paths: ["1. Projects/demo/New.md"],
          index_paths: ["1. Projects/demo/_index.md"],
          link_pairs: [
            { source_path: "1. Projects/demo/_index.md", target_path: "1. Projects/demo/New.md" }
          ],
          links_added: 2,
          backlinks_added: 1,
          frontmatter_completed: 1,
          summaries_completed: 1,
          validation: "passed",
          confidence: "high",
          prompt: "PRIVATE BUILD PROMPT"
        }),
        JSON.stringify({
          event: "BuildComplete",
          query_id: "build-turn-1",
          operation_id: "ingest-op-1",
          operation_kind: "ingest",
          operation_elapsed_ms: 46_200,
          timestamp: "2026-08-06T10:00:46.200+09:00",
          token_is_operation_delta: true,
          token_reliability: "high",
          token_total_for_analysis: 8_400
        }),
        JSON.stringify({
          event: "Stop",
          query_id: "build-turn-1",
          timestamp: "2026-08-06T10:10:00.000+09:00",
          elapsed_ms: 600_000,
          token_is_request_delta: true,
          token_reliability: "high",
          token_total_for_analysis: 2400
        })
      ].join("\n"),
      "0. Common/query-telemetry.jsonl"
    );

    const journeys = groupQueryJourneys(parsed);
    const build = journeys.find((journey) => journey.queryId === "ingest-op-1");
    expect(build).toMatchObject({
      queryId: "ingest-op-1",
      requestId: "build-turn-1",
      startedAt: "2026-08-06T10:00:00.000+09:00",
      endedAt: "2026-08-06T10:00:46.200+09:00",
      durationMs: { value: 46_200, confidence: "measured" },
      totalTokens: { value: 8_400, confidence: "measured" },
      documentsReadPaths: ["3. Resources/topic/Source.md"],
      buildSummary: {
        operationType: "create",
        route: "kb-ingest",
        kbIngestUsed: true,
        createdPaths: ["1. Projects/demo/New.md"],
        linksAdded: { value: 2, confidence: "measured" },
        validation: "passed"
      }
    });
    expect(build?.buildSummary?.linkPairs).toHaveLength(1);
    expect(build?.events.map((event) => event.kind)).toEqual(["BuildStart", "BuildSummary", "BuildComplete"]);
    expect(journeys.find((journey) => journey.queryId === "build-turn-1")?.durationMs.value).toBeNull();
    expect(JSON.stringify(build)).not.toContain("PRIVATE");
  });

  it("orders journeys by timestamp instant when telemetry mixes UTC and local offsets", () => {
    const parsed = parseTelemetryJsonl(
      [
        JSON.stringify({ event: "Stop", query_id: "later", timestamp: "2026-08-06T01:30:00.000Z" }),
        JSON.stringify({ event: "Stop", query_id: "earlier", timestamp: "2026-08-06T10:00:00.000+09:00" })
      ].join("\n"),
      "0. Common/query-telemetry.jsonl"
    );

    expect(groupQueryJourneys(parsed).map((journey) => journey.queryId)).toEqual(["earlier", "later"]);
  });

  it("normalizes generic event aliases and nested JSON fields into the same query model", () => {
    const parsed = parseTelemetryJsonl(
      [
        JSON.stringify({
          event_type: "query.started",
          trace_id: "trace-1",
          request_id: "request-1",
          observed_at: "2026-08-06T01:00:00.000Z"
        }),
        JSON.stringify({
          event_type: "query.result",
          trace_id: "trace-1",
          request_id: "request-1",
          observed_at: "2026-08-06T01:00:05.000Z",
          retrieved_paths: ["Projects/demo/index.md", "Resources/topic/Note.md"],
          retrieved_count: 2,
          entry_paths: ["Projects/demo/index.md"],
          hop_count: 2,
          confidence: "high",
          query: "PRIVATE GENERIC QUERY"
        }),
        JSON.stringify({
          event_type: "query.completed",
          trace_id: "trace-1",
          request_id: "request-1",
          observed_at: "2026-08-06T01:00:09.000Z",
          latency_ms: 9_000,
          tokens_are_operation_delta: true,
          token_reliability: "high",
          usage: { input_tokens: 2_400, output_tokens: 800, total_tokens: 3_200 }
        })
      ].join("\n"),
      "telemetry/search.jsonl",
      GENERIC_JSONL_TELEMETRY_SCHEMA
    );

    const journey = groupQueryJourneys(parsed)[0];
    expect(journey).toMatchObject({
      queryId: "trace-1",
      requestId: "request-1",
      completed: true,
      durationMs: { value: 9_000, confidence: "measured", source: "QueryComplete.latency_ms" },
      totalTokens: { value: 3_200, confidence: "measured", source: "QueryComplete.usage.total_tokens" },
      documentsReadPaths: ["Projects/demo/index.md", "Resources/topic/Note.md"],
      entrypoints: ["Projects/demo/index.md"]
    });
    expect(journey?.events.map((event) => event.kind)).toEqual(["QueryStart", "QuerySummary", "QueryComplete"]);
    expect(JSON.stringify(journey)).not.toContain("PRIVATE");
  });

  it("aggregates privacy-preserving retrieval lens usage separately from UI usage", () => {
    const parsed = parseTelemetryJsonl(
      [
        JSON.stringify({
          event: "QueryStart",
          operation_id: "query-op-1",
          query_id: "q1",
          timestamp: "2026-08-05T00:59:59.500Z"
        }),
        JSON.stringify({
          event: "QuerySummary",
          query_id: "q1",
          operation_id: "query-op-1",
          timestamp: "2026-08-05T01:00:00.000Z",
          documents_read_count: 2,
          documents_read_paths: ["1. Projects/demo/_index.md", "1. Projects/demo/spec.md"],
          search_step_count: 1,
          confidence: "high",
          query: "do not store this"
        }),
        JSON.stringify({
          event: "QueryComplete",
          query_id: "q1",
          operation_id: "query-op-1",
          timestamp: "2026-08-05T01:00:01.000Z",
          operation_elapsed_ms: 500,
          token_is_operation_delta: true,
          token_reliability: "high",
          token_total_for_analysis: 1200
        })
      ].join("\n"),
      "0. Common/query-telemetry.jsonl"
    );

    const summary = aggregateLensUsage(groupQueryJourneys(parsed), parsed, {
      generatedAt: "2026-08-05T03:00:00.000Z"
    });

    expect(summary.buckets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lensId: "projects:index",
          queryCount: 1,
          accessCount: 1,
          uniquePathRefs: [stableHash("1. Projects/demo/_index.md")],
          durationP50Ms: 500,
          tokensP90: 1200,
          confidence: "measured"
        })
      ])
    );
    expect(JSON.stringify(summary)).not.toContain("do not store this");
    expect(JSON.stringify(summary)).not.toContain("1. Projects/demo/spec.md");
  });

  it("aggregates lens UI usage without note, query, or title payloads", () => {
    const summary = aggregateLensUiUsage(
      [
        { id: "1", observedAt: "2026-08-05T01:00:00.000Z", lensId: "query-journey", action: "open" },
        {
          id: "2",
          observedAt: "2026-08-05T01:01:00.000Z",
          lensId: "query-journey",
          action: "foreground",
          dwellMs: 45_000
        },
        { id: "3", observedAt: "2026-08-05T01:02:00.000Z", lensId: "query-journey", action: "replay" },
        { id: "4", observedAt: "2026-08-05T01:03:00.000Z", lensId: "query-journey", action: "compare" },
        { id: "5", observedAt: "2026-08-05T01:04:00.000Z", lensId: "query-journey", action: "filter" },
        { id: "6", observedAt: "2026-08-05T01:05:00.000Z", lensId: "query-journey", action: "drilldown" },
        { id: "7", observedAt: "2026-08-05T01:06:00.000Z", lensId: "query-journey", action: "unavailable" }
      ],
      "2026-08-05T02:00:00.000Z"
    );

    expect(summary).toEqual({
      generatedAt: "2026-08-05T02:00:00.000Z",
      privacy: {
        notePayloadRetained: false,
        queryPayloadRetained: false,
        titlePayloadRetained: false
      },
      buckets: [
        {
          lensId: "query-journey",
          openCount: 1,
          foregroundDwellBucket: "medium",
          replayUsed: true,
          compareUsed: true,
          filterUsed: true,
          drilldownUsed: true,
          unavailableCount: 1
        }
      ]
    });
  });
});
