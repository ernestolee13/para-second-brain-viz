import type { GraphSnapshot } from "../model";

export interface SnapshotStorage {
  readText(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<void>;
  listFiles(prefix: string): Promise<string[]>;
}

export class InMemorySnapshotStorage implements SnapshotStorage {
  private readonly files = new Map<string, string>();

  async readText(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async listFiles(prefix: string): Promise<string[]> {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort();
  }
}

export interface SnapshotRepositoryOptions {
  rootPath?: string;
}

const DEFAULT_SNAPSHOT_ROOT = ".obsidian/plugins/llm-wiki-observatory/snapshots";

export class SnapshotRepository {
  private readonly rootPath: string;

  constructor(
    private readonly storage: SnapshotStorage,
    options: SnapshotRepositoryOptions = {}
  ) {
    this.rootPath = canonicalSnapshotRoot(options.rootPath ?? DEFAULT_SNAPSHOT_ROOT);
  }

  async save(snapshot: GraphSnapshot): Promise<string> {
    const path = this.pathFor(snapshot);
    await this.storage.writeText(path, `${JSON.stringify(snapshot, null, 2)}\n`);
    return path;
  }

  async load(path: string): Promise<GraphSnapshot | null> {
    const text = await this.storage.readText(path);
    if (text === null) return null;
    return JSON.parse(text) as GraphSnapshot;
  }

  async list(): Promise<string[]> {
    return this.storage.listFiles(`${this.rootPath}/`);
  }

  private pathFor(snapshot: GraphSnapshot): string {
    const safeScope = safeSnapshotScopeId(snapshot.scope.id);
    const safeObservedAt = snapshot.observedAt.replace(/[^a-zA-Z0-9._-]+/g, "-");
    return `${this.rootPath}/${safeScope}/${safeObservedAt}.json`;
  }
}

export function safeSnapshotScopeId(scopeId: string): string {
  return scopeId.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function canonicalSnapshotRoot(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  return normalized.replace(/\/+$/, "") || DEFAULT_SNAPSHOT_ROOT;
}
