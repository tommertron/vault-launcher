# Vault Launcher

An Obsidian plugin for an inbox-style workflow built on frontmatter flags and Bases.

- **Notes list** in the sidebar: every note regardless of folder, sorted by modified date, with **Inbox**, **Starred** and **All** tabs and a filter box.
- **Shortcuts**: open any file in your vault (usually a `.base`) from the command palette (`Open <name>`) and, optionally, a ribbon icon.
- **Flag buttons** in each note's header, plus commands, to toggle `_organized`, `_archived` and `_starred` in frontmatter.

## How the flags work

| Flag | Meaning |
| --- | --- |
| `_organized: true` | The note has been filed, so it leaves the Inbox. |
| `_archived: true` | The note is archived. It leaves the Inbox and is hidden from All unless you switch that on. |
| `_starred: true` | The note shows in the Starred tab. |

Notes with `type: Type` are also left out of the Inbox.

## Settings

- **Note header buttons**: choose which of Organize, Archive and Star appear on notes.
- **Shortcuts**: one row per file, with a name, a path relative to the vault root (e.g. `Bases/Inbox.base`), a [Lucide](https://lucide.dev/icons/) icon name, and a ribbon toggle. Command and ribbon changes apply when you close settings.
- **Notes list**: ribbon icon, plus folders and note names to hide from the Inbox and All tabs.
- **Turning a flag off**: set the field to `false`, or remove it.

## Install

### With BRAT (gets updates)

1. Install the **BRAT** community plugin.
2. Run **BRAT: Add a beta plugin for testing** and enter `tommertron/vault-launcher`.
3. Enable **Vault Launcher** under Community plugins.

### By hand

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/tommertron/vault-launcher/releases/latest).
2. Put them in `<your vault>/.obsidian/plugins/vault-launcher/`.
3. Reload Obsidian and enable **Vault Launcher** under Community plugins.

## Releasing

Bump `version` in `manifest.json`, add it to `versions.json`, then create a GitHub release tagged with the bare version number (e.g. `1.5.0`) with `main.js`, `manifest.json` and `styles.css` attached.
