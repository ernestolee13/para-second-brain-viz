import { classifyPara, classifyRole, defaultAdapterConfig, AdapterConfig } from "../adapters/generic";
import { LensUsageBucket, LensUsageSummary, NoteRole, ParaCategory, QueryJourney, TelemetryLineResult } from "../model";
import { stableHash } from "./hash";

export interface LensAggregationOptions {
  generatedAt: string;
  hashPathRefs?: boolean;
  adapterConfig?: AdapterConfig;
}

interface MutableBucket {
  para: ParaCategory;
  role: NoteRole | "mixed";
  requestIds: Set<string>;
  accessCount: number;
  pathRefs: Set<string>;
  durations: number[];
  tokens: number[];
}

export function aggregateLensUsage(
  journeys: QueryJourney[],
  parsedLines: TelemetryLineResult[],
  options: LensAggregationOptions
): LensUsageSummary {
  const config = options.adapterConfig ?? defaultAdapterConfig;
  const hashPathRefs = options.hashPathRefs ?? true;
  const buckets = new Map<string, MutableBucket>();

  for (const journey of journeys.filter((candidate) =>
    candidate.buildSummary === null && candidate.events.some((event) => event.kind === "QuerySummary")
  )) {
    for (const path of journey.accessedPaths) {
      const para = classifyPara(path, config);
      const role = classifyRole(path, {}, config);
      const lensId = `${para}:${role}`;
      const bucket = buckets.get(lensId) ?? {
        para,
        role,
        requestIds: new Set<string>(),
        accessCount: 0,
        pathRefs: new Set<string>(),
        durations: [],
        tokens: []
      };
      bucket.requestIds.add(journey.queryId);
      bucket.accessCount += 1;
      bucket.pathRefs.add(hashPathRefs ? stableHash(path) : path);
      if (journey.durationMs.value !== null) bucket.durations.push(journey.durationMs.value);
      if (journey.totalTokens.value !== null) bucket.tokens.push(journey.totalTokens.value);
      buckets.set(lensId, bucket);
    }
  }

  return {
    generatedAt: options.generatedAt,
    privacy: {
      hashedPathRefs: hashPathRefs,
      rawPromptRetained: false
    },
    buckets: [...buckets.entries()]
      .map(([lensId, bucket]): LensUsageBucket => ({
        lensId,
        para: bucket.para,
        role: bucket.role,
        queryCount: bucket.requestIds.size,
        accessCount: bucket.accessCount,
        uniquePathRefs: [...bucket.pathRefs].sort(),
        durationP50Ms: percentile(bucket.durations, 0.5),
        durationP90Ms: percentile(bucket.durations, 0.9),
        tokensP50: percentile(bucket.tokens, 0.5),
        tokensP90: percentile(bucket.tokens, 0.9),
        confidence: bucket.accessCount > 0 ? "measured" : "unavailable"
      }))
      .sort((left, right) => right.accessCount - left.accessCount || left.lensId.localeCompare(right.lensId)),
    skippedMalformedLines: parsedLines.filter((line) => line.malformed).length
  };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? null;
}
