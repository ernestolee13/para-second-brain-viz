import type { TFile } from "obsidian";

export interface ObservatoryFileStat {
  ctime?: number;
  mtime?: number;
  size?: number;
}

export interface ObservatoryMarkdownFile {
  path: string;
  basename?: string;
  extension?: string;
  stat?: ObservatoryFileStat;
}

export interface ObservatoryLinkCache {
  link: string;
  displayText?: string;
}

export interface ObservatoryFileCache {
  frontmatter?: Record<string, unknown>;
  links?: ObservatoryLinkCache[];
}

export interface ObservatoryAdapterList {
  files: string[];
  folders: string[];
}

export interface ObservatoryAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<ObservatoryAdapterList>;
  stat?(path: string): Promise<ObservatoryFileStat | null>;
}

export interface ObservatoryVault {
  adapter: ObservatoryAdapter;
  configDir?: string;
  getMarkdownFiles(): Array<TFile | ObservatoryMarkdownFile>;
}

export interface ObservatoryMetadataCache {
  getFileCache(file: TFile | ObservatoryMarkdownFile): ObservatoryFileCache | null;
}

export interface ObservatoryWorkspace {
  openLinkText?(linktext: string, sourcePath: string, newLeaf?: boolean): Promise<void>;
}

export interface ObservatoryAppLike {
  vault: ObservatoryVault;
  metadataCache: ObservatoryMetadataCache;
  workspace?: ObservatoryWorkspace;
}
