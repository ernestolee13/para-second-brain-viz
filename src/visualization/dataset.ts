import { compareNullableTimestamps, type GraphSnapshot, type QueryJourney, type SnapshotDiff } from "../model";
import type { DataCapability, ObservatoryDataset } from "./types";

export interface ObservatoryDatasetInput {
  current: GraphSnapshot;
  snapshots?: GraphSnapshot[];
  diffs?: SnapshotDiff[];
  journeys?: QueryJourney[];
  generatedAt?: string;
  additionalCapabilities?: Iterable<DataCapability>;
}

export function createObservatoryDataset(input: ObservatoryDatasetInput): ObservatoryDataset {
  const snapshots = [...(input.snapshots ?? [])].sort(
    (left, right) => compareNullableTimestamps(left.observedAt, right.observedAt) || left.id.localeCompare(right.id)
  );
  const diffs = [...(input.diffs ?? [])].sort(
    (left, right) => left.beforeId.localeCompare(right.beforeId) || left.afterId.localeCompare(right.afterId)
  );
  const journeys = [...(input.journeys ?? [])].sort(
    (left, right) =>
      compareNullableTimestamps(left.startedAt, right.startedAt) || left.queryId.localeCompare(right.queryId)
  );
  const capabilities = inferDataCapabilities(input.current, snapshots, diffs, journeys);
  for (const capability of input.additionalCapabilities ?? []) capabilities.add(capability);

  return {
    current: input.current,
    snapshots,
    diffs,
    journeys,
    capabilities,
    generatedAt: input.generatedAt ?? input.current.observedAt
  };
}

export function inferDataCapabilities(
  current: GraphSnapshot,
  snapshots: GraphSnapshot[],
  diffs: SnapshotDiff[],
  journeys: QueryJourney[]
): Set<DataCapability> {
  const capabilities = new Set<DataCapability>(["vault-notes", "vault-links"]);
  const queryJourneys = journeys.filter((journey) =>
    journey.buildSummary === null && journey.events.some((event) => event.kind === "QuerySummary")
  );
  if (current.notes.some((note) => note.para !== "unknown")) capabilities.add("para");
  if (current.notes.some((note) => note.role === "index")) capabilities.add("indexes");
  if (current.notes.some((note) => note.sizeBytes !== null)) capabilities.add("file-stats");
  if (current.notes.some((note) => note.createdTime !== null || note.modifiedTime !== null)) {
    capabilities.add("file-times");
  }
  if (diffs.length > 0) capabilities.add("snapshots");
  if (snapshots.length >= 2 && diffs.length > 0) capabilities.add("snapshot-history");
  if (queryJourneys.length > 0) capabilities.add("query-aggregate");
  if (queryJourneys.some((journey) => journey.accessedPaths.length > 0 || journey.documentsReadPaths.length > 0)) {
    capabilities.add("query-paths");
  }
  if (queryJourneys.some((journey) => journey.steps.length > 0)) capabilities.add("query-steps");
  if (queryJourneys.some((journey) => journey.durationMs.value !== null)) capabilities.add("query-timing");
  if (queryJourneys.some((journey) => journey.totalTokens.value !== null)) capabilities.add("query-tokens");
  if (queryJourneys.some((journey) => journey.tools.length > 0)) capabilities.add("tool-usage");
  if (
    queryJourneys.some((journey) =>
      journey.events.some((event) => event.toolName !== null && event.durationMs.value !== null)
    )
  ) {
    capabilities.add("tool-timing");
  }
  return capabilities;
}
