const {
  Plugin, PluginSettingTab, Setting, Notice, TFile, MarkdownView,
  ItemView, Platform, Keymap, debounce, moment, setIcon,
} = require("obsidian");


// Frontmatter flags toggled from each note's header (and by command).
// view.addAction prepends, so the header shows these right-to-left.
const FLAGS = [
  { key: "_starred", id: "star", icon: "star", on: "Starred", off: "Unstarred", verb: "Star" },
  { key: "_archived", id: "archive", icon: "archive", on: "Archived", off: "Unarchived", verb: "Archive" },
  { key: "_organized", id: "organize", icon: "check", on: "Organized", off: "Not organized", verb: "Organize" },
];

const ACTION_CLASS = "vault-launcher-action";

// The flat "Notes list" view: every note regardless of folder, by modified date.
const VIEW_TYPE = "vault-launcher-notes";
const LIST_RIBBON = "Notes list";
const LISTS = [
  { id: "inbox", label: "Inbox" },
  { id: "starred", label: "Starred" },
  { id: "all", label: "All" },
];
// Saved in this plugin's data.json, so they sync to every device.
const DEFAULT_SETTINGS = {
  buttons: { _organized: true, _archived: true, _starred: true },
  ribbon: { [LIST_RIBBON]: true },
  // Files to open from a command (and optionally a ribbon icon). Any file type works.
  targets: [
    { label: "Inbox", path: "Bases/Inbox.base", icon: "inbox", ribbon: true },
    { label: "Starred", path: "Bases/Starred.base", icon: "star", ribbon: true },
    { label: "Types", path: "Bases/Types.base", icon: "shapes", ribbon: true },
  ],
  // Left out of the Inbox and All tabs of the notes list.
  hiddenFolders: ["attachments", "Templates"],
  hiddenNames: [],
  offMode: "false", // "false" = write false; "remove" = delete the field
  list: { view: "inbox", sort: "desc", showArchived: false },
};

const commandId = (label) => `open-${label.trim().toLowerCase().replace(/\s+/g, "-")}`;

class VaultLauncher extends Plugin {
  async onload() {
    const saved = (await this.loadData()) || {};
    this.settings = {
      buttons: { ...DEFAULT_SETTINGS.buttons, ...saved.buttons },
      ribbon: { ...DEFAULT_SETTINGS.ribbon, ...saved.ribbon },
      targets: saved.targets || DEFAULT_SETTINGS.targets.map((t) => ({ ...t })),
      hiddenFolders: saved.hiddenFolders || [...DEFAULT_SETTINGS.hiddenFolders],
      hiddenNames: saved.hiddenNames || [...DEFAULT_SETTINGS.hiddenNames],
      offMode: saved.offMode || DEFAULT_SETTINGS.offMode,
      list: { ...DEFAULT_SETTINGS.list, ...saved.list },
    };
    this.addSettingTab(new VaultLauncherSettings(this.app, this));

    this.registerView(VIEW_TYPE, (leaf) => new NotesListView(leaf, this));
    this.ribbonEls = {};
    this.ribbonEls[LIST_RIBBON] = this.addRibbonIcon("list", "Open notes list", () => this.openList());
    this.addCommand({ id: "open-notes-list", name: "Open notes list", callback: () => this.openList() });

    this.targetRibbons = [];
    this.targetCommands = [];
    this.buildTargets();

    for (const flag of FLAGS) {
      this.addCommand({
        id: `toggle-${flag.id}`,
        name: `Toggle ${flag.verb}`,
        icon: flag.icon,
        // Plain callback (not checkCallback) so the command is always listed,
        // including in the mobile toolbar settings where no note is active.
        callback: () => {
          const file = this.app.workspace.getActiveFile();
          if (!file || file.extension !== "md") {
            new Notice("Open a note first");
            return;
          }
          this.toggle(file, flag);
        },
      });
    }

    const refreshAll = () => this.refreshAll();
    this.app.workspace.onLayoutReady(refreshAll);
    this.registerEvent(this.app.workspace.on("layout-change", refreshAll));
    this.registerEvent(this.app.workspace.on("file-open", refreshAll));
    this.registerEvent(this.app.metadataCache.on("changed", refreshAll));
  }

  // (Re)create the command and ribbon icon for each target. Called again when settings change.
  buildTargets() {
    this.targetRibbons.forEach((el) => el.remove());
    this.targetCommands.forEach((id) => this.app.commands?.removeCommand?.(`${this.manifest.id}:${id}`));
    this.targetRibbons = [];
    this.targetCommands = [];

    const seen = new Set();
    for (const { label, path, icon, ribbon } of this.settings.targets) {
      if (!label?.trim() || !path?.trim()) continue;
      const id = commandId(label);
      if (seen.has(id)) continue;
      seen.add(id);
      const open = async () => {
        const file = this.app.vault.getAbstractFileByPath(path.trim());
        if (!(file instanceof TFile)) {
          new Notice(`Vault Launcher: ${path} not found`);
          return;
        }
        await this.app.workspace.getLeaf(false).openFile(file);
      };
      if (ribbon) this.targetRibbons.push(this.addRibbonIcon(icon?.trim() || "file", `Open ${label}`, open));
      this.addCommand({ id, name: `Open ${label}`, callback: open });
      this.targetCommands.push(id);
    }
  }

  refreshAll() {
    for (const [label, el] of Object.entries(this.ribbonEls)) {
      el.style.display = this.settings.ribbon[label] ? "" : "none";
    }
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => this.decorate(leaf.view));
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.refreshAll();
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => leaf.view.render());
  }

  // Show the notes list in the left sidebar (reusing it if it's already open).
  async openList() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  onunload() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      leaf.view.containerEl.querySelectorAll(`.${ACTION_CLASS}`).forEach((el) => el.remove());
      delete leaf.view._vaultLauncher;
    }
  }

  // Add the header buttons to a markdown view (once), then sync them to the note's flags.
  decorate(view) {
    if (!(view instanceof MarkdownView)) return;
    if (!view._vaultLauncher) {
      view._vaultLauncher = {};
      for (const flag of FLAGS) {
        const el = view.addAction(flag.icon, flag.verb, () => {
          if (view.file) this.toggle(view.file, flag);
        });
        el.addClass(ACTION_CLASS);
        el.dataset.flag = flag.id;
        view._vaultLauncher[flag.key] = el;
      }
    }
    const fm = (view.file && this.app.metadataCache.getFileCache(view.file)?.frontmatter) || {};
    for (const flag of FLAGS) {
      const el = view._vaultLauncher[flag.key];
      const on = fm[flag.key] === true;
      el.style.display = this.settings.buttons[flag.key] ? "" : "none";
      el.toggleClass("is-on", on);
      el.setAttribute("aria-label", on ? `${flag.on} — tap to undo` : flag.verb);
    }
  }

  async toggle(file, flag) {
    let on;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      on = fm[flag.key] !== true;
      if (on || this.settings.offMode === "false") fm[flag.key] = on;
      else delete fm[flag.key];
    });
    new Notice(`${file.basename}: ${on ? flag.on : flag.off}`);
  }
};

class NotesListView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.query = "";
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Notes"; }
  getIcon() { return "list"; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("vault-launcher-notes");

    this.tabsEl = root.createDiv("vln-tabs");
    for (const list of LISTS) {
      const tab = this.tabsEl.createEl("button", { cls: "vln-tab", text: list.label });
      tab.dataset.list = list.id;
      tab.onclick = () => {
        this.plugin.settings.list.view = list.id;
        this.plugin.saveSettings();
      };
    }

    const bar = root.createDiv("vln-bar");
    this.searchEl = bar.createEl("input", { cls: "vln-search", type: "search", placeholder: "Filter by name or folder" });
    this.searchEl.oninput = () => {
      this.query = this.searchEl.value.trim().toLowerCase();
      this.render();
    };
    this.sortEl = bar.createDiv("vln-sort clickable-icon");
    this.sortEl.onclick = () => {
      const list = this.plugin.settings.list;
      list.sort = list.sort === "desc" ? "asc" : "desc";
      this.plugin.saveSettings();
    };

    this.countEl = root.createDiv("vln-count");
    this.listEl = root.createDiv("vln-list");

    const refresh = debounce(() => this.render(), 300, true);
    for (const ev of ["create", "delete", "rename", "modify"]) {
      this.registerEvent(this.app.vault.on(ev, refresh));
    }
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.workspace.on("file-open", () => this.markActive()));
    this.render();
  }

  // Which notes belong in the current list, newest or oldest first.
  notes() {
    const { view, sort, showArchived } = this.plugin.settings.list;
    const { hiddenFolders, hiddenNames } = this.plugin.settings;
    const cache = this.app.metadataCache;
    const notes = this.app.vault.getMarkdownFiles().filter((file) => {
      const fm = cache.getFileCache(file)?.frontmatter || {};
      if (view === "starred") return fm._starred === true;
      if (hiddenNames.includes(file.basename)) return false;
      if (hiddenFolders.some((f) => file.path.startsWith(f + "/"))) return false;
      if (view === "inbox") return fm._organized !== true && fm._archived !== true && fm.type !== "Type";
      return showArchived || fm._archived !== true;
    });
    const dir = sort === "desc" ? -1 : 1;
    return notes.sort((a, b) => dir * (a.stat.mtime - b.stat.mtime));
  }

  render() {
    if (!this.listEl) return;
    const { view, sort } = this.plugin.settings.list;
    for (const tab of this.tabsEl.children) tab.toggleClass("is-active", tab.dataset.list === view);
    setIcon(this.sortEl, sort === "desc" ? "arrow-down-wide-narrow" : "arrow-up-narrow-wide");
    this.sortEl.setAttribute("aria-label", sort === "desc" ? "Newest first (tap for oldest)" : "Oldest first (tap for newest)");

    let notes = this.notes();
    if (this.query) notes = notes.filter((f) => f.path.toLowerCase().includes(this.query));
    this.countEl.setText(`${notes.length} note${notes.length === 1 ? "" : "s"}`);

    const active = this.app.workspace.getActiveFile()?.path;
    const frag = document.createDocumentFragment();
    for (const file of notes) {
      const item = frag.createDiv("vln-item");
      item.dataset.path = file.path;
      if (file.path === active) item.addClass("is-active");
      const title = item.createDiv("vln-title");
      title.createSpan({ text: file.basename });
      if (view !== "starred" && this.app.metadataCache.getFileCache(file)?.frontmatter?._starred === true) {
        setIcon(title.createSpan("vln-star"), "star");
      }
      const meta = item.createDiv("vln-meta");
      meta.createSpan({ cls: "vln-date", text: this.formatDate(file.stat.mtime) });
      if (file.parent && !file.parent.isRoot()) meta.createSpan({ cls: "vln-folder", text: file.parent.path });
      item.onclick = (evt) => this.openNote(file, evt);
    }
    this.listEl.empty();
    if (!notes.length) this.listEl.createDiv({ cls: "vln-empty", text: this.query ? "No matches" : "Nothing here" });
    this.listEl.appendChild(frag);
  }

  formatDate(ms) {
    const m = moment(ms);
    if (m.isSame(moment(), "day")) return m.format("LT");
    if (m.isSame(moment(), "year")) return m.format("MMM D");
    return m.format("MMM D, YYYY");
  }

  markActive() {
    const active = this.app.workspace.getActiveFile()?.path;
    for (const item of this.listEl.children) item.toggleClass("is-active", item.dataset.path === active);
  }

  async openNote(file, evt) {
    await this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file);
    // On phone/iPad, close the drawer like the file explorer does.
    const root = this.leaf.getRoot();
    if (Platform.isMobile && root !== this.app.workspace.rootSplit && root.collapse) root.collapse();
  }
}

class VaultLauncherSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl).setName("Note header buttons").setHeading();
    for (const flag of [...FLAGS].reverse()) {
      new Setting(containerEl)
        .setName(flag.verb)
        .setDesc(`Show the ${flag.verb} button at the top of each note (toggles ${flag.key}).`)
        .addToggle((t) =>
          t.setValue(settings.buttons[flag.key]).onChange(async (v) => {
            settings.buttons[flag.key] = v;
            await this.plugin.saveSettings();
          })
        );
    }

    new Setting(containerEl)
      .setName("Shortcuts")
      .setDesc(
        "Files to open from the command palette (\"Open <name>\") and, if switched on, a ribbon icon. " +
        "Paths are relative to the vault root, e.g. Bases/Inbox.base. Icons are Lucide names, e.g. inbox, star."
      )
      .setHeading();
    settings.targets.forEach((target, i) => {
      new Setting(containerEl)
        .setClass("vault-launcher-target")
        .addText((t) => t.setPlaceholder("Name").setValue(target.label).onChange(async (v) => {
          target.label = v;
          await this.save();
        }))
        .addText((t) => t.setPlaceholder("Path/to/file.base").setValue(target.path).onChange(async (v) => {
          target.path = v;
          await this.save();
        }))
        .addText((t) => t.setPlaceholder("Icon").setValue(target.icon || "").onChange(async (v) => {
          target.icon = v;
          await this.save();
        }))
        .addToggle((t) => t.setTooltip("Show in ribbon").setValue(!!target.ribbon).onChange(async (v) => {
          target.ribbon = v;
          await this.save();
        }))
        .addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(async () => {
          settings.targets.splice(i, 1);
          await this.save();
          this.display();
        }));
    });
    new Setting(containerEl).addButton((b) =>
      b.setButtonText("Add shortcut").onClick(async () => {
        settings.targets.push({ label: "", path: "", icon: "", ribbon: false });
        await this.save();
        this.display();
      })
    );

    new Setting(containerEl).setName("Notes list").setHeading();
    new Setting(containerEl)
      .setName("Ribbon icon")
      .setDesc("Show the \"Open notes list\" icon in the ribbon.")
      .addToggle((t) =>
        t.setValue(settings.ribbon[LIST_RIBBON]).onChange(async (v) => {
          settings.ribbon[LIST_RIBBON] = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Hidden folders")
      .setDesc("One per line. Notes in these folders are left out of the Inbox and All tabs.")
      .addTextArea((t) =>
        t.setValue(settings.hiddenFolders.join("\n")).onChange(async (v) => {
          settings.hiddenFolders = splitLines(v).map((f) => f.replace(/\/+$/, ""));
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Hidden note names")
      .setDesc("One per line, without .md. Notes with these names are left out of the Inbox and All tabs.")
      .addTextArea((t) =>
        t.setValue(settings.hiddenNames.join("\n")).onChange(async (v) => {
          settings.hiddenNames = splitLines(v);
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("Show archived notes in All")
      .setDesc("Off: the All tab hides notes with _archived: true.")
      .addToggle((t) =>
        t.setValue(settings.list.showArchived).onChange(async (v) => {
          settings.list.showArchived = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName("Behaviour").setHeading();
    new Setting(containerEl)
      .setName("Turning a flag off")
      .setDesc("What un-organizing, un-archiving or un-starring a note does to its field.")
      .addDropdown((d) =>
        d
          .addOption("false", "Set it to false (keeps the field)")
          .addOption("remove", "Remove the field")
          .setValue(settings.offMode)
          .onChange(async (v) => {
            settings.offMode = v;
            await this.plugin.saveSettings();
          })
      );
  }

  // Shortcut edits save as you type; commands and ribbon icons are rebuilt when settings close.
  async save() {
    this.targetsChanged = true;
    await this.plugin.saveSettings();
  }

  hide() {
    if (this.targetsChanged) this.plugin.buildTargets();
    this.targetsChanged = false;
  }
}

const splitLines = (text) => text.split("\n").map((s) => s.trim()).filter(Boolean);

module.exports = VaultLauncher;
