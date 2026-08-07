import {
  ConstructionSummary,
  Confidence,
  MetricReading,
  QueryJourney,
  QueryStep,
  QueryTelemetryEvent,
  TelemetryLineResult,
  compareNullableTimestamps,
  metricReading,
  normalizePath
} from "../model";
import type { TelemetryEventAliases, TelemetrySchemaMapping } from "../plugin/contracts";
import { LLM_WIKI_TELEMETRY_SCHEMA } from "../plugin/profiles";

export function parseTelemetryJsonl(
  text: string,
  source: string,
  schema: TelemetrySchemaMapping = LLM_WIKI_TELEMETRY_SCHEMA
): TelemetryLineResult[] {
  return text.split(/\r?\n/).flatMap((lineText, index): TelemetryLineResult[] => {
    const line = index + 1;
    if (lineText.trim().length === 0) return [];
    try {
      const raw = JSON.parse(lineText) as Record<string, unknown>;
      return [normalizeTelemetryRecord(raw, source, line, schema)];
    } catch (error) {
      return [
        {
          id: `${source}:${line}:malformed`,
          source,
          line,
          rawLength: lineText.length,
          error: error instanceof Error ? error.message : String(error),
          malformed: true
        }
      ];
    }
  });
}

export function groupQueryJourneys(results: TelemetryLineResult[]): QueryJourney[] {
  const events = results.filter((result): result is QueryTelemetryEvent => !result.malformed);
  const groups = new Map<string, QueryTelemetryEvent[]>();
  for (const event of events) {
    const grouped = groups.get(event.queryId) ?? [];
    grouped.push(event);
    groups.set(event.queryId, grouped);
  }

  return [...groups.entries()]
    .map(([queryId, grouped]) => toJourney(queryId, grouped.sort(compareEvents)))
    .sort((left, right) => compareNullableTimestamps(left.startedAt, right.startedAt));
}

function normalizeTelemetryRecord(
  raw: Record<string, unknown>,
  source: string,
  line: number,
  schema: TelemetrySchemaMapping
): QueryTelemetryEvent {
  const fields = schema.coreFields;
  const rawKind = firstStringField(raw, fields.eventKind)?.value ?? "unknown";
  const kind = canonicalEventKind(rawKind, schema.events);
  const observedAt = firstStringField(raw, fields.observedAt)?.value ?? null;
  const operationId = firstStringField(raw, fields.operationId)?.value ?? null;
  const parentQueryId = firstStringField(raw, fields.parentQueryId)?.value ?? null;
  const queryId =
    operationId ?? parentQueryId ?? firstStringField(raw, fields.requestId)?.value ??
    `${source}:ungrouped:${line}`;
  const requestId = firstStringField(raw, fields.requestId)?.value ?? parentQueryId ?? queryId;
  const sessionId = firstStringField(raw, fields.sessionId)?.value ?? null;
  const isStop = kind === "Stop";
  const isQuerySummary = kind === "QuerySummary";
  const isQueryComplete = kind === "QueryComplete";
  const isAutoPathSummary = kind === "AutoPathSummary";
  const isBuildSummary = kind === "BuildSummary";
  const isBuildComplete = kind === "BuildComplete";
  const isOperationMeasurement = isQuerySummary || isQueryComplete || isBuildSummary || isBuildComplete;
  const evidenceTokenConfidence = tokenConfidence(raw, schema, isOperationMeasurement);
  const stepPaths = collectStepPaths(raw, fields.stepPaths);
  const buildSummary = isBuildSummary ? normalizeConstructionSummary(raw, schema) : null;
  const durationField = isOperationMeasurement
    ? firstNumberField(raw, fields.operationDurationMs)
    : isStop
      ? firstNumberField(raw, fields.turnDurationMs)
      : firstNumberField(raw, fields.eventDurationMs);
  const inputTokens = firstNumberField(raw, fields.inputTokens);
  const outputTokens = firstNumberField(raw, fields.outputTokens);
  const totalTokens = firstNumberField(
    raw,
    isStop || isOperationMeasurement ? fields.operationTotalTokens : fields.eventTotalTokens
  );
  const confidence = confidenceFromRaw(firstStringField(raw, fields.confidence)?.value);
  const documentsReadPaths = graphPathAliases(raw, fields.documentsReadPaths);
  const autoDocumentsReadPaths = graphPathAliases(raw, fields.autoDocumentsReadPaths);
  const entrypoints = graphPathAliases(raw, fields.entrypoints);
  const autoEntrypoints = graphPathAliases(raw, fields.autoEntrypoints);
  const documentsReadCount = firstField(raw, fields.documentsReadCount);
  const autoDocumentsReadCount = firstField(raw, fields.autoDocumentsReadCount);
  const searchStepCount = firstField(raw, fields.searchStepCount);
  const autoSearchStepCount = firstField(raw, fields.autoSearchStepCount);

  return {
    id: `${source}:${line}`,
    observedAt,
    kind,
    queryId,
    requestId,
    sessionId,
    durationMs: measuredNumber(
      durationField?.value,
      metricSource(kind, isStop ? null : durationField, isOperationMeasurement
        ? "operation_elapsed_ms"
        : isStop
          ? "turn_elapsed_ms"
          : "duration_ms")
    ),
    inputTokens: tokenReading(
      inputTokens?.value ?? null,
      isStop || isOperationMeasurement,
      evidenceTokenConfidence,
      metricSource(kind, inputTokens, "input_tokens")
    ),
    outputTokens: tokenReading(
      outputTokens?.value ?? null,
      isStop || isOperationMeasurement,
      evidenceTokenConfidence,
      metricSource(kind, outputTokens, "output_tokens")
    ),
    totalTokens: tokenReading(
      totalTokens?.value ?? null,
      isStop || isOperationMeasurement,
      evidenceTokenConfidence,
      metricSource(kind, totalTokens, isStop || isOperationMeasurement ? "token_total_for_analysis" : "total_tokens")
    ),
    toolName: firstStringField(raw, fields.toolName)?.value ?? null,
    accessedPaths: isQuerySummary
      ? documentsReadPaths
      : isAutoPathSummary
        ? autoDocumentsReadPaths
        : buildSummary?.referencePaths ?? stepPaths,
    stepPaths,
    documentsReadPaths: isQuerySummary
      ? documentsReadPaths
      : isAutoPathSummary
        ? autoDocumentsReadPaths
        : buildSummary?.referencePaths ?? [],
    documentsReadCount: isQuerySummary
      ? readingFromNullable(
          documentsReadCount?.value,
          metricSource("QuerySummary", documentsReadCount, "documents_read_count"),
          confidence
        )
      : isAutoPathSummary
        ? readingFromNullable(
            autoDocumentsReadCount?.value,
            metricSource("AutoPathSummary", autoDocumentsReadCount, "documents_read_count_auto"),
            "inferred"
          )
        : metricReading(null, "unavailable", `${kind}.documents_read_count`),
    entrypoints: isQuerySummary ? entrypoints : isAutoPathSummary ? autoEntrypoints : [],
    searchStepCount: isQuerySummary
      ? readingFromNullable(
          searchStepCount?.value,
          metricSource("QuerySummary", searchStepCount, "search_step_count"),
          confidence
        )
      : isAutoPathSummary
        ? readingFromNullable(
            autoSearchStepCount?.value,
            metricSource("AutoPathSummary", autoSearchStepCount, "search_step_count_auto"),
            "inferred"
          )
        : metricReading(null, "unavailable", `${kind}.search_step_count`),
    completed: isStop || isQueryComplete || isBuildComplete ? true : null,
    buildSummary,
    source,
    line,
    malformed: false
  };
}

function toJourney(queryId: string, events: QueryTelemetryEvent[]): QueryJourney {
  const timestamps = events.map((event) => event.observedAt).filter((value): value is string => value !== null);
  const queryStart = events.find((event) => event.kind === "QueryStart");
  const buildStart = events.find((event) => event.kind === "BuildStart");
  const operationStart = queryStart ?? buildStart;
  const querySummary = events.find((event) => event.kind === "QuerySummary");
  const autoPathSummary = events.find((event) => event.kind === "AutoPathSummary");
  const buildSummaryEvent = events.find((event) => event.kind === "BuildSummary");
  const buildSummary = buildSummaryEvent?.buildSummary ?? null;
  const operationSummary = querySummary ?? buildSummaryEvent;
  const operationComplete = events.find((event) => event.kind === "QueryComplete" || event.kind === "BuildComplete");
  const documentsReadPaths = uniqueInOrder(
    (querySummary?.documentsReadPaths.length
      ? querySummary.documentsReadPaths
      : buildSummary?.referencePaths.length
        ? buildSummary.referencePaths
        : autoPathSummary?.documentsReadPaths) ?? []
  );
  const entrypoints = uniqueInOrder(
    (querySummary?.entrypoints.length ? querySummary.entrypoints : autoPathSummary?.entrypoints) ?? []
  );
  const steps = events
    .filter((event) => event.stepPaths.length > 0 && !["QuerySummary", "BuildSummary", "AutoPathSummary"].includes(event.kind))
    .map(
      (event, index): QueryStep => ({
        index,
        eventId: event.id,
        observedAt: event.observedAt,
        toolName: event.toolName,
        paths: event.stepPaths
      })
    );
  const accessedPaths = uniqueInOrder(
    documentsReadPaths.length > 0 ? documentsReadPaths : events.flatMap((event) => event.accessedPaths)
  );
  const legacySemanticSummary = operationStart === undefined && operationSummary !== undefined;
  const completed = operationComplete?.completed === true || legacySemanticSummary;
  const measuredEvent = operationComplete ?? operationSummary;

  return {
    queryId,
    requestId: events.find((event) => event.requestId)?.requestId ?? queryId,
    sessionId: events.find((event) => event.sessionId !== null)?.sessionId ?? null,
    startedAt: operationStart?.observedAt ?? operationSummary?.observedAt ?? timestamps[0] ?? null,
    endedAt: operationComplete?.observedAt ?? operationSummary?.observedAt ?? timestamps.at(-1) ?? null,
    durationMs: measuredEvent?.durationMs ?? metricReading(null, "unavailable", "operation.operation_elapsed_ms"),
    inputTokens: measuredEvent?.inputTokens ?? metricReading(null, "unavailable", "operation.input_tokens"),
    outputTokens: measuredEvent?.outputTokens ?? metricReading(null, "unavailable", "operation.output_tokens"),
    totalTokens: measuredEvent?.totalTokens ?? metricReading(null, "unavailable", "operation.token_total_for_analysis"),
    documentsReadCount:
      querySummary?.documentsReadCount ??
      autoPathSummary?.documentsReadCount ??
      metricReading(null, "unavailable", "journey.documents_read_count"),
    searchStepCount:
      querySummary?.searchStepCount ??
      autoPathSummary?.searchStepCount ??
      metricReading(null, "unavailable", "journey.search_step_count"),
    completed,
    completionConfidence: operationComplete ? "measured" : legacySemanticSummary ? "inferred" : "unavailable",
    tools: uniqueSorted(events.map((event) => event.toolName).filter((value): value is string => value !== null)),
    accessedPaths,
    documentsReadPaths,
    entrypoints,
    buildSummary,
    steps,
    events
  };
}

function normalizeConstructionSummary(
  raw: Record<string, unknown>,
  schema: TelemetrySchemaMapping
): ConstructionSummary {
  const fields = schema.buildFields;
  const confidence = confidenceFromRaw(firstStringField(raw, schema.coreFields.confidence)?.value);
  const linksAdded = firstField(raw, fields.linksAdded);
  const backlinksAdded = firstField(raw, fields.backlinksAdded);
  const frontmatterCompleted = firstField(raw, fields.frontmatterCompleted);
  const summariesCompleted = firstField(raw, fields.summariesCompleted);
  return {
    schemaVersion: firstNumberField(raw, fields.schemaVersion)?.value ?? 1,
    operationType: firstStringField(raw, fields.operationType)?.value ?? "unknown",
    route: firstStringField(raw, fields.route)?.value ?? "unknown",
    kbIngestUsed: firstBooleanField(raw, fields.kbIngestUsed)?.value ?? null,
    referencePaths: graphPathAliases(raw, fields.referencePaths),
    createdPaths: graphPathAliases(raw, fields.createdPaths),
    updatedPaths: graphPathAliases(raw, fields.updatedPaths),
    movedFromPaths: graphPathAliases(raw, fields.movedFromPaths),
    movedToPaths: graphPathAliases(raw, fields.movedToPaths),
    indexPaths: graphPathAliases(raw, fields.indexPaths),
    linkPairs: constructionLinkPairs(firstField(raw, fields.linkPairs)?.value),
    linksAdded: readingFromNullable(
      linksAdded?.value,
      metricSource("BuildSummary", linksAdded, "links_added"),
      confidence
    ),
    backlinksAdded: readingFromNullable(
      backlinksAdded?.value,
      metricSource("BuildSummary", backlinksAdded, "backlinks_added"),
      confidence
    ),
    frontmatterCompleted: readingFromNullable(
      frontmatterCompleted?.value,
      metricSource("BuildSummary", frontmatterCompleted, "frontmatter_completed"),
      confidence
    ),
    summariesCompleted: readingFromNullable(
      summariesCompleted?.value,
      metricSource("BuildSummary", summariesCompleted, "summaries_completed"),
      confidence
    ),
    validation: constructionValidation(firstField(raw, fields.validation)?.value),
    confidence
  };
}

function constructionLinkPairs(value: unknown): ConstructionSummary["linkPairs"] {
  if (!Array.isArray(value)) return [];
  const pairs: ConstructionSummary["linkPairs"] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const object = asObject(item);
    const sourcePath = firstString(object?.source_path, object?.source, object?.from);
    const targetPath = firstString(object?.target_path, object?.target, object?.to);
    if (!sourcePath || !targetPath) continue;
    const source = cleanPathLike(sourcePath);
    const target = cleanPathLike(targetPath);
    if (!isGraphPathCandidate(source) || !isGraphPathCandidate(target)) continue;
    const key = `${source}->${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ sourcePath: source, targetPath: target });
  }
  return pairs.slice(0, 50);
}

function constructionValidation(value: unknown): ConstructionSummary["validation"] {
  return value === "passed" || value === "partial" || value === "failed" ? value : "unknown";
}

function collectStepPaths(raw: Record<string, unknown>, aliases: string[]): string[] {
  const values = stringArraysForAliases(raw, aliases);
  return uniqueInOrder(values.map(cleanPathLike).filter(isGraphPathCandidate));
}

function tokenConfidence(
  raw: Record<string, unknown>,
  schema: TelemetrySchemaMapping,
  operationMeasurement: boolean
): Confidence {
  const fields = schema.coreFields;
  if (firstField(raw, fields.operationTotalTokens)?.value === null) return "unavailable";
  const deltaAliases = operationMeasurement ? fields.operationTokenDelta : fields.requestTokenDelta;
  const isDelta = firstBooleanField(raw, deltaAliases)?.value === true;
  if (!isDelta) return "inferred";
  const reliability = firstStringField(raw, fields.tokenReliability)?.value ?? null;
  if (reliability === "high") return "measured";
  if (reliability === "medium" || reliability === "low") return "inferred";
  return "unavailable";
}

function tokenReading(value: number | null, isStop: boolean, confidence: Confidence, source: string): MetricReading {
  if (!isStop) return value === null ? metricReading(null, "unavailable", source) : metricReading(value, "inferred", source);
  return value === null || confidence === "unavailable"
    ? metricReading(null, "unavailable", source)
    : metricReading(value, confidence, source);
}

function readingFromNullable(value: unknown, source: string, confidence: Confidence): MetricReading {
  const number = firstNumber(value);
  return number === null ? metricReading(null, "unavailable", source) : metricReading(number, confidence, source);
}

function measuredNumber(value: unknown, source: string): MetricReading {
  return readingFromNullable(value, source, "measured");
}

function confidenceFromRaw(value: unknown): Confidence {
  return value === "high" ? "measured" : value === "medium" || value === "low" ? "inferred" : "unavailable";
}

interface FieldMatch<T = unknown> {
  alias: string;
  value: T;
}

const CANONICAL_EVENTS: Array<{
  key: keyof TelemetryEventAliases;
  kind: string;
}> = [
  { key: "stop", kind: "Stop" },
  { key: "queryStart", kind: "QueryStart" },
  { key: "operationStep", kind: "OperationStep" },
  { key: "querySummary", kind: "QuerySummary" },
  { key: "queryComplete", kind: "QueryComplete" },
  { key: "autoPathSummary", kind: "AutoPathSummary" },
  { key: "buildStart", kind: "BuildStart" },
  { key: "buildSummary", kind: "BuildSummary" },
  { key: "buildComplete", kind: "BuildComplete" }
];

function canonicalEventKind(value: string, aliases: TelemetryEventAliases): string {
  const normalized = value.trim().toLocaleLowerCase();
  for (const event of CANONICAL_EVENTS) {
    if (aliases[event.key].some((alias) => alias.trim().toLocaleLowerCase() === normalized)) {
      return event.kind;
    }
  }
  return value;
}

function firstField(raw: Record<string, unknown>, aliases: readonly string[]): FieldMatch | null {
  for (const alias of aliases) {
    const result = valueAtPath(raw, alias);
    if (result.found) return { alias, value: result.value };
  }
  return null;
}

function firstStringField(raw: Record<string, unknown>, aliases: readonly string[]): FieldMatch<string> | null {
  for (const alias of aliases) {
    const result = valueAtPath(raw, alias);
    if (result.found && typeof result.value === "string" && result.value.trim().length > 0) {
      return { alias, value: result.value.trim() };
    }
  }
  return null;
}

function firstNumberField(raw: Record<string, unknown>, aliases: readonly string[]): FieldMatch<number> | null {
  for (const alias of aliases) {
    const result = valueAtPath(raw, alias);
    if (result.found && typeof result.value === "number" && Number.isFinite(result.value)) {
      return { alias, value: result.value };
    }
  }
  return null;
}

function firstBooleanField(raw: Record<string, unknown>, aliases: readonly string[]): FieldMatch<boolean> | null {
  for (const alias of aliases) {
    const result = valueAtPath(raw, alias);
    if (result.found && typeof result.value === "boolean") return { alias, value: result.value };
  }
  return null;
}

function stringArraysForAliases(raw: Record<string, unknown>, aliases: readonly string[]): string[] {
  return aliases.flatMap((alias) => stringArray(valueAtPath(raw, alias).value));
}

function graphPathAliases(raw: Record<string, unknown>, aliases: readonly string[]): string[] {
  return uniqueInOrder(stringArraysForAliases(raw, aliases));
}

function valueAtPath(
  raw: Record<string, unknown>,
  alias: string
): { found: boolean; value: unknown } {
  if (Object.prototype.hasOwnProperty.call(raw, alias)) return { found: true, value: raw[alias] };
  const segments = alias.split(".").filter(Boolean);
  if (segments.length < 2) return { found: false, value: undefined };
  let current: unknown = raw;
  for (const segment of segments) {
    const object = asObject(current);
    if (!object || !Object.prototype.hasOwnProperty.call(object, segment)) {
      return { found: false, value: undefined };
    }
    current = object[segment];
  }
  return { found: true, value: current };
}

function metricSource(kind: string, field: FieldMatch | null, fallback: string): string {
  return `${kind}.${field?.alias ?? fallback}`;
}

function cleanPathLike(path: string): string {
  return normalizePath(path.replace(/^Vault\//, "").trim());
}

function isGraphPathCandidate(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith("http:/") || path.startsWith("https:/")) return false;
  if (path.includes("\n") || path.includes("|")) return false;
  return path.endsWith(".md") || path.endsWith(".jsonl");
}

function compareEvents(left: QueryTelemetryEvent, right: QueryTelemetryEvent): number {
  return compareNullableTimestamps(left.observedAt, right.observedAt) || left.line - right.line;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").filter((item) => item.trim().length > 0);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values.map(cleanPathLike).filter(isGraphPathCandidate))];
}
