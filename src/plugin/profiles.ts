import type {
  TelemetryProfileId,
  TelemetrySchemaMapping,
  VaultProfileId
} from "./contracts";
import type { ParaRootRule } from "../adapters/generic";

export interface VaultProfileDefinition {
  id: Exclude<VaultProfileId, "custom">;
  label: string;
  description: string;
  paraRoots: ParaRootRule[];
  indexFileNames: string[];
  spinePaths: string[];
  telemetryPaths: string[];
  telemetryArchiveFolders: string[];
  exclusions: string[];
}

export interface TelemetryProfileDefinition {
  id: Exclude<TelemetryProfileId, "custom">;
  label: string;
  description: string;
  schema: TelemetrySchemaMapping;
}

export const LLM_WIKI_VAULT_PROFILE: VaultProfileDefinition = {
  id: "llm-wiki-para",
  label: "LLM wiki PARA",
  description: "Numbered PARA roots, a Common knowledge core, Inbox, and kb-query/kb-ingest telemetry.",
  paraRoots: [
    { para: "common", prefix: "0. Common/" },
    { para: "projects", prefix: "1. Projects/" },
    { para: "areas", prefix: "2. Areas/" },
    { para: "resources", prefix: "3. Resources/" },
    { para: "archive", prefix: "4. Archive/" },
    { para: "inbox", prefix: "Inbox/" }
  ],
  indexFileNames: ["index.md", "_index.md"],
  spinePaths: ["CLAUDE.md", "AGENTS.md", "MEMORY.md", "0. Common/log.md"],
  telemetryPaths: ["0. Common/query-telemetry.jsonl"],
  telemetryArchiveFolders: ["0. Common/telemetry-archive"],
  exclusions: [
    "$CONFIG_DIR/",
    ".omx/",
    ".trash/",
    "_resource/"
  ]
};

export const STANDARD_PARA_VAULT_PROFILE: VaultProfileDefinition = {
  id: "standard-para",
  label: "Standard PARA",
  description: "Unnumbered Common, Projects, Areas, Resources, Archive, and Inbox roots.",
  paraRoots: [
    { para: "common", prefix: "Common/" },
    { para: "projects", prefix: "Projects/" },
    { para: "areas", prefix: "Areas/" },
    { para: "resources", prefix: "Resources/" },
    { para: "archive", prefix: "Archive/" },
    { para: "inbox", prefix: "Inbox/" }
  ],
  indexFileNames: ["index.md", "_index.md"],
  spinePaths: ["README.md", "Common/index.md"],
  telemetryPaths: [],
  telemetryArchiveFolders: [],
  exclusions: ["$CONFIG_DIR/", ".trash/"]
};

export const PARA_KB_V1_VAULT_PROFILE: VaultProfileDefinition = {
  ...LLM_WIKI_VAULT_PROFILE,
  id: "para-kb-v1",
  label: "PARA Knowledge Base v1",
  description: "Portable roots, indexes, spine notes, exclusions, and telemetry from .para-kb/config.json."
};

export const VAULT_PROFILES: Record<Exclude<VaultProfileId, "custom">, VaultProfileDefinition> = {
  "para-kb-v1": PARA_KB_V1_VAULT_PROFILE,
  "llm-wiki-para": LLM_WIKI_VAULT_PROFILE,
  "standard-para": STANDARD_PARA_VAULT_PROFILE
};

export const LLM_WIKI_TELEMETRY_SCHEMA: TelemetrySchemaMapping = {
  events: {
    stop: ["Stop"],
    queryStart: ["QueryStart"],
    operationStep: ["OperationStep"],
    querySummary: ["QuerySummary"],
    queryComplete: ["QueryComplete"],
    autoPathSummary: ["AutoPathSummary"],
    buildStart: ["BuildStart"],
    buildSummary: ["BuildSummary"],
    buildComplete: ["BuildComplete"]
  },
  coreFields: {
    eventKind: ["event", "type", "name", "kind"],
    observedAt: ["timestamp", "observedAt", "time", "created_at"],
    operationId: ["operation_id", "operationId"],
    parentQueryId: ["request_id", "requestId", "query_id", "queryId", "turn_id", "turnId"],
    requestId: ["request_id", "requestId", "query_id", "queryId"],
    sessionId: ["session_id", "sessionId", "conversation_id"],
    operationDurationMs: ["operation_elapsed_ms"],
    turnDurationMs: ["turn_elapsed_ms", "elapsed_ms"],
    eventDurationMs: ["duration_ms", "elapsedMs", "timing.duration_ms"],
    inputTokens: ["input_tokens", "inputTokens", "usage.input_tokens", "usage.prompt_tokens"],
    outputTokens: ["output_tokens", "outputTokens", "usage.output_tokens", "usage.completion_tokens"],
    operationTotalTokens: ["token_total_for_analysis", "total_reported_tokens", "total_tokens", "usage.total_tokens"],
    eventTotalTokens: ["total_tokens", "totalTokens", "usage.total_tokens"],
    operationTokenDelta: ["token_is_operation_delta"],
    requestTokenDelta: ["token_is_request_delta"],
    tokenReliability: ["token_reliability"],
    toolName: ["tool_name", "toolName", "tool"],
    stepPaths: ["vault_paths", "command_vault_paths", "output_vault_paths"],
    documentsReadPaths: ["documents_read_paths"],
    autoDocumentsReadPaths: ["documents_read_paths_auto"],
    documentsReadCount: ["documents_read_count"],
    autoDocumentsReadCount: ["documents_read_count_auto"],
    entrypoints: ["entrypoints"],
    autoEntrypoints: ["entrypoints_auto"],
    searchStepCount: ["search_step_count"],
    autoSearchStepCount: ["search_step_count_auto"],
    confidence: ["confidence"]
  },
  buildFields: {
    schemaVersion: ["schema_version", "summary_schema_version"],
    operationType: ["operation_type", "operation"],
    route: ["route", "build_route"],
    kbIngestUsed: ["kb_ingest_used"],
    referencePaths: ["reference_paths"],
    createdPaths: ["created_paths"],
    updatedPaths: ["updated_paths"],
    movedFromPaths: ["moved_from_paths"],
    movedToPaths: ["moved_to_paths"],
    indexPaths: ["index_paths"],
    linkPairs: ["link_pairs"],
    linksAdded: ["links_added"],
    backlinksAdded: ["backlinks_added"],
    frontmatterCompleted: ["frontmatter_completed"],
    summariesCompleted: ["summaries_completed"],
    validation: ["validation"]
  }
};

export const GENERIC_JSONL_TELEMETRY_SCHEMA: TelemetrySchemaMapping = {
  events: {
    stop: ["stop", "request_complete", "turn_complete"],
    queryStart: ["query_start", "query.started", "search_start", "search.started"],
    operationStep: ["operation_step", "trace.step", "retrieval.step", "tool_call"],
    querySummary: ["query_summary", "query.result", "search_summary", "search.result"],
    queryComplete: ["query_complete", "query.completed", "search_complete", "search.completed"],
    autoPathSummary: ["path_summary", "retrieval_summary"],
    buildStart: ["build_start", "build.started", "ingest_start", "ingest.started"],
    buildSummary: ["build_summary", "build.result", "ingest_summary", "ingest.result"],
    buildComplete: ["build_complete", "build.completed", "ingest_complete", "ingest.completed"]
  },
  coreFields: {
    eventKind: ["event", "event_type", "type", "kind"],
    observedAt: ["timestamp", "observed_at", "time", "created_at"],
    operationId: ["operation_id", "trace_id", "run_id", "id"],
    parentQueryId: ["query_id", "request_id", "turn_id"],
    requestId: ["request_id", "query_id"],
    sessionId: ["session_id", "conversation_id"],
    operationDurationMs: ["duration_ms", "latency_ms", "elapsed_ms"],
    turnDurationMs: ["turn_duration_ms", "request_duration_ms"],
    eventDurationMs: ["duration_ms", "latency_ms", "elapsed_ms", "timing.duration_ms"],
    inputTokens: ["input_tokens", "usage.input_tokens", "usage.prompt_tokens"],
    outputTokens: ["output_tokens", "usage.output_tokens", "usage.completion_tokens"],
    operationTotalTokens: ["total_tokens", "usage.total_tokens", "tokens"],
    eventTotalTokens: ["total_tokens", "usage.total_tokens", "tokens"],
    operationTokenDelta: ["token_is_operation_delta", "tokens_are_operation_delta"],
    requestTokenDelta: ["token_is_request_delta", "tokens_are_request_delta"],
    tokenReliability: ["token_reliability", "confidence"],
    toolName: ["tool_name", "tool", "retriever"],
    stepPaths: ["paths", "documents", "document_paths", "retrieved_paths"],
    documentsReadPaths: ["documents", "document_paths", "retrieved_paths"],
    autoDocumentsReadPaths: ["auto_document_paths"],
    documentsReadCount: ["document_count", "documents_read_count", "retrieved_count"],
    autoDocumentsReadCount: ["auto_document_count"],
    entrypoints: ["entrypoints", "entry_paths"],
    autoEntrypoints: ["auto_entrypoints"],
    searchStepCount: ["step_count", "search_step_count", "hop_count"],
    autoSearchStepCount: ["auto_step_count"],
    confidence: ["confidence"]
  },
  buildFields: {
    schemaVersion: ["schema_version"],
    operationType: ["operation_type", "action"],
    route: ["route", "pipeline"],
    kbIngestUsed: ["ingest_pipeline_used"],
    referencePaths: ["reference_paths", "source_paths", "documents"],
    createdPaths: ["created_paths", "outputs.created"],
    updatedPaths: ["updated_paths", "outputs.updated"],
    movedFromPaths: ["moved_from_paths", "outputs.moved_from"],
    movedToPaths: ["moved_to_paths", "outputs.moved_to"],
    indexPaths: ["index_paths", "indexes"],
    linkPairs: ["link_pairs", "links"],
    linksAdded: ["links_added"],
    backlinksAdded: ["backlinks_added"],
    frontmatterCompleted: ["metadata_completed"],
    summariesCompleted: ["summaries_completed"],
    validation: ["validation", "status"]
  }
};

export const PARA_KB_V1_TELEMETRY_SCHEMA: TelemetrySchemaMapping = {
  events: {
    ...LLM_WIKI_TELEMETRY_SCHEMA.events,
    operationStep: ["OperationStep", "PostToolUse", "ToolCall"]
  },
  coreFields: {
    ...LLM_WIKI_TELEMETRY_SCHEMA.coreFields,
    operationId: ["operation_id", "operationId"],
    parentQueryId: ["request_id", "requestId", "query_id", "queryId", "turn_id", "turnId"],
    requestId: ["request_id", "requestId", "query_id", "queryId"],
    stepPaths: ["vault_paths", "command_vault_paths", "output_vault_paths"]
  },
  buildFields: {
    ...LLM_WIKI_TELEMETRY_SCHEMA.buildFields,
    schemaVersion: ["schema_version", "summary_schema_version"]
  }
};

export const TELEMETRY_PROFILES: Record<Exclude<TelemetryProfileId, "custom">, TelemetryProfileDefinition> = {
  "para-kb-v1": {
    id: "para-kb-v1",
    label: "PARA Knowledge Base v1",
    description: "Canonical privacy-safe Query/Build lifecycle with OperationStep and request_id grouping.",
    schema: PARA_KB_V1_TELEMETRY_SCHEMA
  },
  "llm-wiki-jsonl": {
    id: "llm-wiki-jsonl",
    label: "LLM wiki JSONL",
    description: "QueryStart/Summary/Complete and BuildStart/Summary/Complete records used by kb-query and kb-ingest.",
    schema: LLM_WIKI_TELEMETRY_SCHEMA
  },
  "generic-jsonl": {
    id: "generic-jsonl",
    label: "Generic JSONL",
    description: "Common snake_case trace, latency, token, document, and ingest fields.",
    schema: GENERIC_JSONL_TELEMETRY_SCHEMA
  }
};

export function cloneTelemetrySchema(schema: TelemetrySchemaMapping): TelemetrySchemaMapping {
  return {
    events: cloneAliases(schema.events),
    coreFields: cloneAliases(schema.coreFields),
    buildFields: cloneAliases(schema.buildFields)
  };
}

function cloneAliases<T extends object>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).map(([key, aliases]) => [key, [...aliases as string[]]])
  ) as T;
}
