# Changelog

## 0.2.4

- Renamed the product and repository to **PARA Second Brain Viz** so it cannot be mistaken for a knowledge-base builder.
- Rewrote the opening description to define the plugin as read-only visual analytics for an existing PARA vault and optional query/build telemetry.
- Updated UI labels, release packaging, bilingual documentation, and key visuals to use the explicit visualization identity.

## 0.2.3

- Renamed the product to **PARA Second Brain** and the public repository to `para-second-brain` so the PARA visualization focus is visible at a glance.
- Added an explicit compatibility section: PARA Knowledge Base is an auto-configured companion, not a required runtime dependency.
- Clarified which structural features remain available when no query/build telemetry is configured.

## 0.2.2

- Prepared Second Brain as an independent public Obsidian plugin repository with MIT licensing and release links.
- Clarified that PARA Knowledge Base integration uses the versioned `.para-kb/config.json` and JSONL contract rather than shared runtime code.
- Removed vault-specific default exclusions and project names from public source and fixtures; private paths remain configurable per vault.

## 0.2.1

- Added read-only `.para-kb/config.json` auto-detection with Auto/Profile/Manual precedence.
- Added the `para-kb-v1` vault and telemetry profiles, canonical `OperationStep`, and `request_id` grouping with legacy aliases.
- Added future schema warnings and cross-project synthetic fixture contract tests.
- Kept prompt, query/answer text, note bodies, unknown payloads, and absolute paths outside normalized replay data.

## 0.2.0

- Added LLM wiki PARA, standard PARA, and custom vault profiles.
- Added LLM wiki, generic JSONL, and custom telemetry mappings with nested field aliases.
- Resolved config and plugin paths through `$CONFIG_DIR` and `$PLUGIN_DIR` tokens.
- Added in-app profile validation and live refresh of enhanced Core Graph sessions.
- Added standard Obsidian release metadata, documentation, packaging, checksums, and release automation.

## 0.1.0

- Initial Second Brain graph, metrics lab, replay, growth, health, and audit prototype.
