import { normalizePath } from "../model";
import type { SnapshotStorage } from "../snapshots/store";
import type { ObservatoryAdapter } from "./types";

export class ObsidianAdapterSnapshotStorage implements SnapshotStorage {
  constructor(private readonly adapter: ObservatoryAdapter) {}

  async readText(path: string): Promise<string | null> {
    const normalized = normalizePath(path);
    if (!(await this.adapter.exists(normalized))) return null;
    return this.adapter.read(normalized);
  }

  async writeText(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    await this.ensureParentDirectory(normalized);
    await this.adapter.write(normalized, content);
  }

  async listFiles(prefix: string): Promise<string[]> {
    const normalized = normalizePath(prefix).replace(/\/?$/, "/");
    if (!(await this.adapter.exists(normalized.replace(/\/$/, "")))) return [];
    const files: string[] = [];
    await this.collectFiles(normalized.replace(/\/$/, ""), files);
    return files.sort();
  }

  private async collectFiles(folder: string, files: string[]): Promise<void> {
    const listed = await this.adapter.list(folder);
    for (const file of listed.files) files.push(normalizePath(file));
    for (const child of listed.folders) await this.collectFiles(normalizePath(child), files);
  }

  private async ensureParentDirectory(path: string): Promise<void> {
    const parts = normalizePath(path).split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current.length === 0 ? part : `${current}/${part}`;
      if (await this.adapter.exists(current)) continue;
      try {
        await this.adapter.mkdir(current);
      } catch (error) {
        if (!(await this.adapter.exists(current))) throw error;
      }
    }
  }
}
