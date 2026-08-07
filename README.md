# Second Brain

Second Brain enhances Obsidian's native graph with a stable PARA layout, semantic index and spine nodes, activity and growth views, query replay, ingest replay, knowledge-health filters, and evidence-aware metrics.

The plugin auto-detects the portable **PARA Knowledge Base v1** contract when a vault contains `.para-kb/config.json`. LLM wiki PARA, standard PARA, and fully custom profiles remain available for independent and legacy setups.

Second Brain is an independent, read-only consumer of the [PARA Knowledge Base](https://github.com/ernestolee13/para-knowledge-base) interoperability contract. It does not embed or import the producer plugin: the only integration boundary is the versioned vault config and privacy-safe JSONL telemetry format.

## What it adds

- PARA territories and first-folder clusters over the native graph renderer
- Fixed semantic core for top-level indexes, schema, memory, and guide notes
- Activity, growth, search replay, ingest replay, construction health, and knowledge-audit modes
- Period and recent-count replay controls with concurrent duration-weighted traces
- Trace inspection and aggregate latency, token, document, link, and PARA reach metrics
- Manual graph snapshots for structural growth comparisons
- Local profile validation for roots, indexes, spine notes, and telemetry sources

Second Brain does not replace Obsidian's graph data. It opens the native Core Graph, applies a curated scope, anchors matching native nodes, and draws its analytical layers above it.

## Installation

### Manual installation

1. Download `manifest.json`, `main.js`, and `styles.css` from the [latest release](https://github.com/ernestolee13/llm-wiki-observatory/releases/latest).
2. Create `<vault-config>/plugins/llm-wiki-observatory/` in your vault.
3. Copy the three files into that folder.
4. Reload Obsidian and enable **Second Brain** under Community plugins.

The vault config directory is commonly `.obsidian`, but the plugin uses Obsidian's configured directory at runtime rather than assuming that name.

## Configuration

Open **Settings → Community plugins → Second Brain**.

### Vault profiles

- **PARA Knowledge Base v1**: read-only runtime mapping from `.para-kb/config.json`, including roots, index names, spine notes, exclusions, active telemetry, and archives.
- **LLM wiki PARA**: `0. Common`, numbered Projects/Areas/Resources/Archive roots, Inbox, `index.md` and `_index.md`, and the current wiki spine and telemetry defaults.
- **Standard PARA**: unnumbered `Common`, `Projects`, `Areas`, `Resources`, `Archive`, and `Inbox` roots.
- **Custom**: edit every structural field directly.

Index filenames are matched at any folder depth. Spine notes are explicit vault-relative paths kept near the semantic core. `$CONFIG_DIR` resolves to the vault's actual Obsidian config directory, and `$PLUGIN_DIR` resolves to this plugin's folder.

**Configuration source** controls precedence:

- **Auto** reads `.para-kb/config.json` for the current load without mutating saved settings; missing config falls back to the saved profile.
- **Saved profile** ignores the config file and uses a preset.
- **Manual fields** ignores the config file and uses editable mappings.

An invalid or future config produces a visible warning. Known fields from a future version are applied conservatively; persisted settings are never silently replaced.

### Telemetry profiles

- **PARA Knowledge Base v1** understands canonical `OperationStep`, `request_id`, and the complete privacy-safe Query/Build lifecycle while retaining legacy aliases.
- **LLM wiki JSONL** understands `QueryStart`, `QuerySummary`, `QueryComplete`, `BuildStart`, `BuildSummary`, and `BuildComplete` records.
- **Generic JSONL** recognizes common `query.started`, `search.result`, `ingest.completed`, trace ID, latency, token, document, and output fields.
- **Custom mapping** exposes every event and field alias as JSON. Aliases are tried from left to right; dot paths such as `usage.total_tokens` address nested fields.

Each JSONL line must contain an event name and a stable operation or trace ID for reliable grouping. Timing, tokens, document paths, query steps, and build evidence are optional; missing values stay explicitly unavailable rather than being fabricated.

See [Telemetry schema](docs/telemetry-schema.md) for canonical events, minimal examples, custom aliases, and confidence rules.

The parser intentionally discards prompt text, query text, note bodies, and unknown payload fields. Lens-usage recording stores only lens ID, action, timestamp, and optional dwell duration.

## Commands

- **Open Second Brain graph**
- **Open Second Brain metrics lab**
- **Refresh Second Brain data**
- **Capture vault snapshot**
- **Validate vault profile**
- **Log lens availability report**

## Development

Requirements: Node.js 20 or newer and an Obsidian desktop test vault.

```bash
npm ci
npm run dev
```

Validation and production build:

```bash
npm run check
npm run package:release
```

The release package is written to `release/second-brain-<version>/` and contains the three Obsidian assets plus SHA-256 checksums. Update the package version with `npm version <version>`; the version hook synchronizes `manifest.json` and `versions.json`.

## Release notes

Release tags must exactly equal the manifest version, without a `v` prefix. `npm run package:release` builds and verifies `main.js`, `manifest.json`, and `styles.css`; repository automation can publish those assets when a release workflow is configured.

Released under the [MIT License](LICENSE).
