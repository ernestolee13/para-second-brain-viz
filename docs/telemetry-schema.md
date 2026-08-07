# Telemetry schema

PARA Second Brain Viz reads newline-delimited JSON and normalizes supported records into query or build journeys. It never stores the original record after parsing.

## Canonical events

| Journey | Start | Evidence summary | Completion |
| --- | --- | --- | --- |
| Search | `QueryStart` | `QuerySummary` | `QueryComplete` |
| Ingest | `BuildStart` | `BuildSummary` | `BuildComplete` |

`OperationStep` carries a tool name and allowlisted vault-relative paths between those boundaries. `AutoPathSummary` can supply inferred search paths for legacy logs when an explicit query summary is unavailable. `Stop` is retained as turn-level evidence but is deliberately excluded from query/build operation duration and token totals.

Every journey should use one stable `operation_id` across its start, steps, summary, and completion records. `request_id` links operations from the same request without collapsing them. Legacy `query_id` remains an input alias only.

## Minimal search journey

```jsonl
{"schema":"para-kb.telemetry","schema_version":1,"event":"QueryStart","operation_id":"query-001","operation_kind":"query","request_id":"request-001","source":"kb-query-skill","timestamp":"2026-08-06T01:00:00Z"}
{"schema":"para-kb.telemetry","schema_version":1,"event":"OperationStep","operation_id":"query-001","operation_kind":"query","request_id":"request-001","source":"runtime-hook","timestamp":"2026-08-06T01:00:02Z","sequence":1,"tool_name":"read","vault_paths":["1. Projects/demo/_index.md"]}
{"schema":"para-kb.telemetry","schema_version":1,"event":"QuerySummary","operation_id":"query-001","operation_kind":"query","request_id":"request-001","source":"kb-query-skill","timestamp":"2026-08-06T01:00:08Z","request_type":"lookup","route":["A:direct-folder"],"documents_read_paths":["1. Projects/demo/_index.md","3. Resources/topic/Note.md"],"documents_read_count":2,"entrypoints":["1. Projects/demo/_index.md"],"search_step_count":2,"confidence":"high"}
{"schema":"para-kb.telemetry","schema_version":1,"event":"QueryComplete","operation_id":"query-001","operation_kind":"query","request_id":"request-001","source":"runtime-hook","timestamp":"2026-08-06T01:00:09Z","operation_elapsed_ms":9000,"token_total_for_analysis":3200,"token_is_operation_delta":true,"token_reliability":"high"}
```

## Minimal ingest journey

```jsonl
{"schema":"para-kb.telemetry","schema_version":1,"event":"BuildStart","operation_id":"build-001","operation_kind":"build","request_id":"request-002","source":"kb-ingest-skill","source_kind":"inbox","timestamp":"2026-08-06T02:00:00Z"}
{"schema":"para-kb.telemetry","schema_version":1,"event":"BuildSummary","operation_id":"build-001","operation_kind":"build","request_id":"request-002","source":"kb-ingest-skill","timestamp":"2026-08-06T02:00:20Z","operation_type":"create","route":"kb-ingest","kb_ingest_used":true,"reference_paths":["Inbox/source.md"],"created_paths":["1. Projects/demo/New note.md"],"updated_paths":[],"moved_from_paths":[],"moved_to_paths":[],"index_paths":["1. Projects/demo/_index.md"],"link_pairs":[{"source_path":"1. Projects/demo/_index.md","target_path":"1. Projects/demo/New note.md"}],"links_added":2,"backlinks_added":0,"frontmatter_completed":1,"summaries_completed":1,"validation":"passed","confidence":"high"}
{"schema":"para-kb.telemetry","schema_version":1,"event":"BuildComplete","operation_id":"build-001","operation_kind":"build","request_id":"request-002","source":"runtime-hook","timestamp":"2026-08-06T02:00:21Z","operation_elapsed_ms":21000,"token_total_for_analysis":null,"token_is_operation_delta":false,"token_reliability":"none"}
```

## Generic JSONL mapping

The Generic JSONL preset also accepts dotted event names and common trace fields, for example:

```jsonl
{"event_type":"query.started","trace_id":"trace-001","request_id":"request-001","observed_at":"2026-08-06T01:00:00Z"}
{"event_type":"query.completed","trace_id":"trace-001","request_id":"request-001","observed_at":"2026-08-06T01:00:09Z","latency_ms":9000,"tokens_are_operation_delta":true,"token_reliability":"high","usage":{"total_tokens":3200}}
```

## Custom mapping

The advanced settings editor contains three complete alias maps:

- `events`: external event values mapped to canonical journey stages
- `coreFields`: IDs, timestamps, duration, token, tool, and retrieval fields
- `buildFields`: references, outputs, indexes, links, metadata, and validation fields

Aliases are evaluated from left to right. A dot path such as `usage.total_tokens` traverses nested objects. Array-valued path aliases are merged and deduplicated. Note paths must end in `.md` to participate in graph replay.

## Evidence confidence

- Duration on a query/build summary or completion record is measured.
- Token totals are measured only when the record says they are an operation delta and reports high reliability.
- Present token totals without reliable delta evidence are inferred.
- Missing or explicitly null values remain unavailable.
- Turn/session totals are never copied onto an operation when attribution is ambiguous.
- Query text, prompts, note bodies, and unrecognized payload fields are discarded.
