import {
  Confidence,
  GraphSnapshot,
  MetricScope,
  NormalizedLink,
  NormalizedNote,
  NoteRole,
  ParaCategory,
  linkId,
  normalizePath,
  noteId
} from "../model";

export interface VaultFileInput {
  path: string;
  basename?: string;
  extension?: string;
  stat?: {
    ctime?: number;
    mtime?: number;
    size?: number;
  };
  frontmatter?: Record<string, unknown>;
  links?: Array<{
    link: string;
    displayText?: string;
  }>;
}

export interface ParaRootRule {
  para: ParaCategory;
  prefix: string;
}

export interface AdapterConfig {
  definitionVersion: string;
  paraRoots: ParaRootRule[];
  indexFileNames: string[];
  telemetryPaths: string[];
  generatedPathPrefixes: string[];
  runtimePathPrefixes: string[];
  exclusions: string[];
}

export const defaultAdapterConfig: AdapterConfig = {
  definitionVersion: "llm-wiki-observatory-adapter-v1",
  paraRoots: [
    { para: "common", prefix: "0. Common/" },
    { para: "projects", prefix: "1. Projects/" },
    { para: "areas", prefix: "2. Areas/" },
    { para: "resources", prefix: "3. Resources/" },
    { para: "archive", prefix: "4. Archive/" },
    { para: "inbox", prefix: "Inbox/" }
  ],
  indexFileNames: ["index.md", "_index.md"],
  telemetryPaths: ["0. Common/query-telemetry.jsonl"],
  generatedPathPrefixes: ["0. Common/reports/"],
  runtimePathPrefixes: [".omx/", ".obsidian/"],
  exclusions: [
    ".obsidian/",
    ".omx/",
    ".trash/",
    "_resource/"
  ]
};

export function createGraphSnapshot(
  files: VaultFileInput[],
  observedAt: string,
  scope: MetricScope,
  config: AdapterConfig = defaultAdapterConfig
): GraphSnapshot {
  const markdownFiles = files
    .filter((file) => isMarkdown(file))
    .filter((file) => !isExcluded(file.path, config));
  const notes = markdownFiles.map((file) => normalizeFileToNote(file, config));
  const links = normalizeLinks(markdownFiles, notes, config);

  return {
    id: `${scope.id}:${observedAt}`,
    definitionVersion: config.definitionVersion,
    scope,
    observedAt,
    notes,
    links,
    metrics: []
  };
}

export function normalizeFileToNote(
  file: VaultFileInput,
  config: AdapterConfig = defaultAdapterConfig
): NormalizedNote {
  const path = normalizePath(file.path);
  const frontmatter = file.frontmatter ?? {};
  const title = asString(frontmatter.title) ?? file.basename ?? basenameWithoutExtension(path);

  return {
    id: noteId(path),
    path,
    title,
    para: classifyPara(path, config),
    role: classifyRole(path, frontmatter, config),
    tags: normalizeTags(frontmatter.tags ?? frontmatter.tag),
    aliases: normalizeAliases(frontmatter.aliases ?? frontmatter.alias),
    summary: asString(frontmatter.summary),
    sizeBytes: toNullableNumber(file.stat?.size),
    createdTime: toNullableNumber(file.stat?.ctime),
    modifiedTime: toNullableNumber(file.stat?.mtime),
    confidence: "measured"
  };
}

export function classifyPara(path: string, config: AdapterConfig = defaultAdapterConfig): ParaCategory {
  const normalized = normalizePath(path);
  const matched = config.paraRoots.find((root) => normalized.startsWith(root.prefix));
  return matched?.para ?? "unknown";
}

export function classifyRole(
  path: string,
  frontmatter: Record<string, unknown> = {},
  config: AdapterConfig = defaultAdapterConfig
): NoteRole {
  const normalized = normalizePath(path);
  const lower = normalized.toLowerCase();
  const fileName = lower.split("/").at(-1) ?? lower;

  if (config.telemetryPaths.includes(normalized)) return "telemetry";
  if (config.runtimePathPrefixes.some((prefix) => normalized.startsWith(prefix))) return "runtime";
  if (config.generatedPathPrefixes.some((prefix) => normalized.startsWith(prefix))) return "generated";
  if (frontmatter.type === "data") return "data";
  if (config.indexFileNames.includes(fileName)) return "index";
  if (fileName === "log.md" || fileName.endsWith("_log.md")) return "log";
  return "content";
}

export function resolveWikiTarget(
  rawTarget: string,
  pathByExact: Map<string, string>,
  pathByStem: Map<string, string | null>
): { path: string; confidence: Confidence; resolved: boolean } {
  const withoutAlias = rawTarget.split("|")[0] ?? rawTarget;
  const withoutHeading = withoutAlias.split("#")[0] ?? withoutAlias;
  const normalized = normalizePath(withoutHeading.trim());
  if (normalized.length === 0) {
    return { path: rawTarget, confidence: "unavailable", resolved: false };
  }

  const candidates = [normalized, normalized.endsWith(".md") ? normalized : `${normalized}.md`];
  for (const candidate of candidates) {
    const exact = pathByExact.get(candidate);
    if (exact) return { path: exact, confidence: "measured", resolved: true };
  }

  const stem = basenameWithoutExtension(normalized);
  const byStem = pathByStem.get(stem.toLowerCase());
  if (byStem) return { path: byStem, confidence: "inferred", resolved: true };
  if (byStem === null) {
    return {
      path: normalized.endsWith(".md") ? normalized : `${normalized}.md`,
      confidence: "unavailable",
      resolved: false
    };
  }

  return {
    path: normalized.endsWith(".md") ? normalized : `${normalized}.md`,
    confidence: "unavailable",
    resolved: false
  };
}

function normalizeLinks(
  files: VaultFileInput[],
  notes: NormalizedNote[],
  config: AdapterConfig
): NormalizedLink[] {
  const pathByExact = new Map(notes.map((note) => [note.path, note.path]));
  const pathByStem = new Map<string, string | null>();
  for (const note of notes) {
    const stem = basenameWithoutExtension(note.path).toLowerCase();
    pathByStem.set(stem, pathByStem.has(stem) ? null : note.path);
  }

  const links: NormalizedLink[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const sourcePath = normalizePath(file.path);
    if (isExcluded(sourcePath, config)) continue;
    for (const rawLink of file.links ?? []) {
      const target = resolveWikiTarget(rawLink.link, pathByExact, pathByStem);
      const id = linkId(sourcePath, target.path);
      if (seen.has(id)) continue;
      seen.add(id);
      const link: NormalizedLink = {
        id,
        sourceId: noteId(sourcePath),
        targetId: noteId(target.path),
        sourcePath,
        targetPath: target.path,
        resolved: target.resolved,
        confidence: target.confidence
      };
      if (rawLink.displayText !== undefined) link.displayText = rawLink.displayText;
      links.push(link);
    }
  }
  return links;
}

function isMarkdown(file: VaultFileInput): boolean {
  if (file.extension) return file.extension.toLowerCase() === "md";
  return normalizePath(file.path).toLowerCase().endsWith(".md");
}

function isExcluded(path: string, config: AdapterConfig): boolean {
  const normalized = normalizePath(path);
  return config.exclusions.some((prefix) => normalized.startsWith(prefix));
}

function basenameWithoutExtension(path: string): string {
  const base = normalizePath(path).split("/").at(-1) ?? path;
  return base.replace(/\.md$/i, "");
}

function normalizeTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  return values.map(String).map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean).sort();
}

function normalizeAliases(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values.map(String).map((alias) => alias.trim()).filter(Boolean).sort();
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
