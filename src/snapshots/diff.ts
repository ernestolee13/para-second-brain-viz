import type { GraphSnapshot, NormalizedLink, NormalizedNote, SnapshotDiff } from "../model";

export function diffSnapshots(before: GraphSnapshot, after: GraphSnapshot): SnapshotDiff {
  assertCompatibleSnapshots(before, after);
  const beforeNotes = new Map(before.notes.map((note) => [note.id, note]));
  const afterNotes = new Map(after.notes.map((note) => [note.id, note]));
  const beforeLinks = new Map(before.links.map((link) => [stableLinkKey(link), link]));
  const afterLinks = new Map(after.links.map((link) => [stableLinkKey(link), link]));

  const addedNotes = after.notes.filter((note) => !beforeNotes.has(note.id));
  const removedNotes = before.notes.filter((note) => !afterNotes.has(note.id));
  const changedNotes = after.notes.flatMap((afterNote) => {
    const beforeNote = beforeNotes.get(afterNote.id);
    if (!beforeNote) return [];
    const changedFields = changedNoteFields(beforeNote, afterNote);
    return changedFields.length > 0 ? [{ before: beforeNote, after: afterNote, changedFields }] : [];
  });
  const addedLinks = after.links.filter((link) => !beforeLinks.has(stableLinkKey(link)));
  const removedLinks = before.links.filter((link) => !afterLinks.has(stableLinkKey(link)));

  return {
    beforeId: before.id,
    afterId: after.id,
    addedNotes,
    removedNotes,
    changedNotes,
    addedLinks,
    removedLinks,
    metrics: {
      noteDelta: after.notes.length - before.notes.length,
      linkDelta: after.links.length - before.links.length,
      resolvedLinkDelta: countResolved(after.links) - countResolved(before.links),
      unresolvedLinkDelta: countUnresolved(after.links) - countUnresolved(before.links)
    }
  };
}

export function snapshotCompatibilityError(
  before: GraphSnapshot,
  after: GraphSnapshot
): string | null {
  if (before.definitionVersion !== after.definitionVersion) {
    return `different definitionVersion: ${before.definitionVersion} !== ${after.definitionVersion}`;
  }
  if (before.scope.id !== after.scope.id) {
    return `different scope id: ${before.scope.id} !== ${after.scope.id}`;
  }
  if (before.scope.pathPrefix !== after.scope.pathPrefix || before.scope.para !== after.scope.para) {
    return "incompatible scope boundaries";
  }
  const beforeExclusions = [...(before.scope.exclusions ?? [])].sort().join("\u0000");
  const afterExclusions = [...(after.scope.exclusions ?? [])].sort().join("\u0000");
  if (beforeExclusions !== afterExclusions) {
    return "different scope exclusions";
  }
  return null;
}

function assertCompatibleSnapshots(before: GraphSnapshot, after: GraphSnapshot): void {
  const incompatibility = snapshotCompatibilityError(before, after);
  if (incompatibility) throw new Error(`Cannot diff snapshots with ${incompatibility}`);
}

export function stableLinkKey(link: NormalizedLink): string {
  return `${link.sourcePath}->${link.targetPath}`;
}

function changedNoteFields(
  before: NormalizedNote,
  after: NormalizedNote
): Array<keyof NormalizedNote> {
  const fields: Array<keyof NormalizedNote> = [
    "path",
    "title",
    "para",
    "role",
    "summary",
    "sizeBytes",
    "createdTime",
    "modifiedTime",
    "confidence"
  ];
  const changed = fields.filter((field) => before[field] !== after[field]);
  if (before.tags.join("\u0000") !== after.tags.join("\u0000")) changed.push("tags");
  if (before.aliases.join("\u0000") !== after.aliases.join("\u0000")) changed.push("aliases");
  return changed;
}

function countResolved(links: NormalizedLink[]): number {
  return links.filter((link) => link.resolved).length;
}

function countUnresolved(links: NormalizedLink[]): number {
  return links.filter((link) => !link.resolved).length;
}
