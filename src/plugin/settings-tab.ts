import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { OBSERVATORY_LENSES } from "../visualization/registry";
import type {
  ObservatoryPluginSettings,
  PeriodPreset,
  TelemetryProfileId,
  VaultProfileId
} from "./contracts";
import { TELEMETRY_PROFILES, VAULT_PROFILES } from "./profiles";
import {
  formatList,
  formatParaRoots,
  formatTelemetrySchema,
  parseList,
  parseParaRoots,
  parseTelemetrySchema,
  telemetryProfilePatch,
  vaultProfilePatch
} from "./settings-model";

export interface ObservatorySettingsHost {
  settings: ObservatoryPluginSettings;
  updateSettings(patch: Partial<ObservatoryPluginSettings>): Promise<void>;
  refreshObservatoryViews(): Promise<void>;
  validateProfile(): Promise<void>;
}

export class ObservatorySettingTab extends PluginSettingTab {
  private refreshTimer: number | null = null;

  constructor(app: App, private readonly host: Plugin & ObservatorySettingsHost) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("llm-observatory-settings");
    new Setting(containerEl).setName("PAVi · PARA Second Brain Viz").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Map a PARA vault and privacy-safe JSONL telemetry into structured graph overlays. The bundled LLM wiki profile matches this vault; presets and aliases make the same plugin portable."
    });

    new Setting(containerEl)
      .setName("Default lens")
      .setDesc("The lens selected when a new PAVi metrics view opens.")
      .addDropdown((dropdown) => {
        dropdown.addOptions(Object.fromEntries(
          OBSERVATORY_LENSES.map((lens) => [lens.id, `${lens.id} · ${lens.title}`])
        ));
        dropdown.setValue(this.host.settings.defaultLensId);
        dropdown.onChange(async (defaultLensId) => this.save({ defaultLensId }));
      });

    new Setting(containerEl)
      .setName("Default period")
      .setDesc("Time window applied to time-aware lenses when a view opens.")
      .addDropdown((dropdown) => {
        dropdown.addOptions({ "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" });
        dropdown.setValue(this.host.settings.defaultPeriod);
        dropdown.onChange(async (value) => this.save({ defaultPeriod: value as PeriodPreset }));
      });

    new Setting(containerEl)
      .setName("Reduce motion")
      .setDesc("Replay controls remain available, but transitions snap to their final state.")
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.reducedMotion);
        toggle.onChange(async (reducedMotion) => this.save({ reducedMotion }));
      });

    new Setting(containerEl)
      .setName("Record lens usage")
      .setDesc("Stores only lens ID, action, time, and optional dwell duration. Note titles and query text are never retained.")
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.recordLensUsage);
        toggle.onChange(async (recordLensUsage) => this.save({ recordLensUsage }));
      });

    new Setting(containerEl).setName("Vault schema").setHeading();
    new Setting(containerEl)
      .setName("Configuration source")
      .setDesc("Auto reads .para-kb/config.json for this vault without overwriting saved settings. Profile and Manual ignore that file.")
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          auto: "Auto · .para-kb/config.json",
          profile: "Saved profile",
          manual: "Manual fields"
        });
        dropdown.setValue(this.host.settings.configSource);
        dropdown.onChange(async (value) => {
          await this.save({ configSource: value as ObservatoryPluginSettings["configSource"] });
          this.display();
        });
      });
    new Setting(containerEl)
      .setName("Vault profile")
      .setDesc(this.vaultProfileDescription())
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          "para-kb-v1": VAULT_PROFILES["para-kb-v1"].label,
          "llm-wiki-para": VAULT_PROFILES["llm-wiki-para"].label,
          "standard-para": VAULT_PROFILES["standard-para"].label,
          custom: "Custom"
        });
        dropdown.setValue(this.host.settings.vaultProfile);
        dropdown.onChange(async (value) => {
          await this.save({ ...vaultProfilePatch(value as VaultProfileId), configSource: value === "custom" ? "manual" : "profile" });
          this.display();
        });
      });

    this.addMultilineSetting(
      "PARA roots",
      "One para=path prefix per line. Supported categories: common, projects, areas, resources, archive, inbox, and unknown.",
      formatParaRoots(this.host.settings.paraRoots),
      async (value) => this.save({ paraRoots: parseParaRoots(value), vaultProfile: "custom", configSource: "manual" }),
      7
    );
    this.addMultilineSetting(
      "Index filenames",
      "Comma- or newline-separated filenames treated as hubs at any folder depth.",
      formatList(this.host.settings.indexFileNames),
      async (value) => this.save({ indexFileNames: parseList(value), vaultProfile: "custom", configSource: "manual" })
    );
    this.addMultilineSetting(
      "Semantic spine notes",
      "Vault-relative guide, schema, memory, or top-level index notes pinned to the knowledge core.",
      formatList(this.host.settings.spinePaths),
      async (value) => this.save({ spinePaths: parseList(value), vaultProfile: "custom", configSource: "manual" })
    );
    this.addMultilineSetting(
      "Excluded path prefixes",
      "Runtime, generated, or private paths omitted from the normalized graph. Use $CONFIG_DIR for the vault config folder.",
      formatList(this.host.settings.exclusions),
      async (value) => this.save({ exclusions: parseList(value), vaultProfile: "custom", configSource: "manual" }),
      6
    );

    new Setting(containerEl)
      .setName("Validate vault profile")
      .setDesc("Checks configured roots, index coverage, spine notes, and telemetry sources without changing files.")
      .addButton((button) => {
        button.setButtonText("Validate");
        button.onClick(async () => this.host.validateProfile());
      });

    new Setting(containerEl).setName("Request telemetry").setHeading();
    new Setting(containerEl)
      .setName("Telemetry format")
      .setDesc(this.telemetryProfileDescription())
      .addDropdown((dropdown) => {
        dropdown.addOptions({
          "para-kb-v1": TELEMETRY_PROFILES["para-kb-v1"].label,
          "llm-wiki-jsonl": TELEMETRY_PROFILES["llm-wiki-jsonl"].label,
          "generic-jsonl": TELEMETRY_PROFILES["generic-jsonl"].label,
          custom: "Custom mapping"
        });
        dropdown.setValue(this.host.settings.telemetryProfile);
        dropdown.onChange(async (value) => {
          await this.save({ ...telemetryProfilePatch(value as TelemetryProfileId), configSource: "manual" });
          this.display();
        });
      });
    this.addMultilineSetting(
      "Active JSONL paths",
      "Current query/build telemetry files. Raw prompts and note bodies are ignored by the parser.",
      formatList(this.host.settings.telemetryPaths),
      async (value) => this.save({ telemetryPaths: parseList(value), vaultProfile: "custom", configSource: "manual" })
    );
    this.addMultilineSetting(
      "Archive folders",
      "Folders scanned for older JSONL telemetry, newest files first.",
      formatList(this.host.settings.telemetryArchiveFolders),
      async (value) => this.save({ telemetryArchiveFolders: parseList(value), vaultProfile: "custom", configSource: "manual" })
    );
    new Setting(containerEl)
      .setName("Maximum archive telemetry files")
      .setDesc("Bounds startup work from archived JSONL files (1–32), in addition to explicit active paths.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "32";
        text.setValue(String(this.host.settings.maxTelemetryFiles));
        text.onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) await this.save({ maxTelemetryFiles: parsed });
        });
      });
    this.addTelemetryMappingEditor();

    new Setting(containerEl).setName("Snapshots").setHeading();
    new Setting(containerEl)
      .setName("Snapshot folder")
      .setDesc("Vault-relative folder for normalized, versioned graph snapshots. $PLUGIN_DIR follows a custom config directory.")
      .addText((text) => {
        text.setPlaceholder("$PLUGIN_DIR/snapshots");
        text.setValue(this.host.settings.snapshotRoot);
        text.onChange(async (snapshotRoot) => {
          if (snapshotRoot.trim()) await this.save({ snapshotRoot: snapshotRoot.trim() });
        });
      });
    new Setting(containerEl)
      .setName("Maximum snapshot files")
      .setDesc("Loads only the newest same-scope snapshots (1–120). Older and incompatible files remain untouched.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "120";
        text.setValue(String(this.host.settings.maxSnapshotFiles));
        text.onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) await this.save({ maxSnapshotFiles: parsed });
        });
      });
  }

  private addTelemetryMappingEditor(): void {
    const details = this.containerEl.createEl("details", { cls: "llm-observatory-settings-details" });
    details.createEl("summary", { text: "Advanced JSONL field mapping" });
    details.createEl("p", {
      cls: "setting-item-description",
      text: "Aliases are tried from left to right. Dot paths such as usage.total_tokens read nested fields. Applying a mapping switches the telemetry format to Custom mapping."
    });
    const editor = details.createEl("textarea", {
      cls: "llm-observatory-settings-schema"
    });
    editor.rows = 18;
    editor.spellcheck = false;
    editor.value = formatTelemetrySchema(this.host.settings.telemetrySchema);
    const feedback = details.createEl("p", {
      cls: "llm-observatory-settings-feedback setting-item-description"
    });

    new Setting(details)
      .setName("Apply field mapping")
      .setDesc("The parser stores normalized timing, token, path, and build evidence only.")
      .addButton((button) => {
        button.setButtonText("Apply mapping");
        button.onClick(async () => {
          const schema = parseTelemetrySchema(editor.value);
          if (!schema) {
            editor.addClass("is-invalid");
            editor.setAttr("aria-invalid", "true");
            feedback.setText("Enter a valid JSON object with events, coreFields, and buildFields mappings.");
            return;
          }
          editor.removeClass("is-invalid");
          editor.removeAttribute("aria-invalid");
          feedback.setText("Mapping applied.");
          await this.save({ telemetrySchema: schema, telemetryProfile: "custom", configSource: "manual" });
        });
      });
  }

  private vaultProfileDescription(): string {
    const id = this.host.settings.vaultProfile;
    return id === "custom"
      ? "Custom roots, hubs, spine notes, source paths, and exclusions."
      : VAULT_PROFILES[id].description;
  }

  private telemetryProfileDescription(): string {
    const id = this.host.settings.telemetryProfile;
    return id === "custom"
      ? "Custom event and field aliases. Edit the advanced mapping below."
      : TELEMETRY_PROFILES[id].description;
  }

  private addMultilineSetting(
    name: string,
    description: string,
    value: string,
    onChange: (value: string) => Promise<void>,
    rows = 4
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addTextArea((text) => {
        text.inputEl.rows = rows;
        text.inputEl.addClass("llm-observatory-settings-textarea");
        text.setValue(value);
        text.onChange(onChange);
      });
  }

  private async save(patch: Partial<ObservatoryPluginSettings>): Promise<void> {
    await this.host.updateSettings(patch);
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.host.refreshObservatoryViews();
    }, 400);
  }
}
