import { LensUiUsageBucket, LensUiUsageEvent, LensUiUsageSummary } from "../model";

interface MutableUiBucket {
  openCount: number;
  foregroundDwellMs: number;
  replayUsed: boolean;
  compareUsed: boolean;
  filterUsed: boolean;
  drilldownUsed: boolean;
  unavailableCount: number;
}

export function aggregateLensUiUsage(events: LensUiUsageEvent[], generatedAt: string): LensUiUsageSummary {
  const buckets = new Map<string, MutableUiBucket>();

  for (const event of events) {
    const bucket = buckets.get(event.lensId) ?? {
      openCount: 0,
      foregroundDwellMs: 0,
      replayUsed: false,
      compareUsed: false,
      filterUsed: false,
      drilldownUsed: false,
      unavailableCount: 0
    };

    if (event.action === "open") bucket.openCount += 1;
    if (event.action === "foreground") bucket.foregroundDwellMs += Math.max(0, event.dwellMs ?? 0);
    if (event.action === "replay") bucket.replayUsed = true;
    if (event.action === "compare") bucket.compareUsed = true;
    if (event.action === "filter") bucket.filterUsed = true;
    if (event.action === "drilldown") bucket.drilldownUsed = true;
    if (event.action === "unavailable") bucket.unavailableCount += 1;

    buckets.set(event.lensId, bucket);
  }

  return {
    generatedAt,
    privacy: {
      notePayloadRetained: false,
      queryPayloadRetained: false,
      titlePayloadRetained: false
    },
    buckets: [...buckets.entries()]
      .map(([lensId, bucket]): LensUiUsageBucket => ({
        lensId,
        openCount: bucket.openCount,
        foregroundDwellBucket: dwellBucket(bucket.foregroundDwellMs),
        replayUsed: bucket.replayUsed,
        compareUsed: bucket.compareUsed,
        filterUsed: bucket.filterUsed,
        drilldownUsed: bucket.drilldownUsed,
        unavailableCount: bucket.unavailableCount
      }))
      .sort((left, right) => right.openCount - left.openCount || left.lensId.localeCompare(right.lensId))
  };
}

function dwellBucket(ms: number): LensUiUsageBucket["foregroundDwellBucket"] {
  if (ms <= 0) return "none";
  if (ms < 30_000) return "short";
  if (ms < 180_000) return "medium";
  return "long";
}
