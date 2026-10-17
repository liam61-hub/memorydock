# MemoryDock Local

`memorydock` is the single-machine MemoryDock package. It runs a local
management console and a stdio MCP adapter for Codex, Claude Code, Cursor, and
other MCP clients. It has no MemoryDock account or token: the service listens
only on loopback and your notes remain on your computer.

## Install and configure from GitHub

```bash
git clone https://github.com/liam61-hub/memorydock.git
cd memorydock/server
npm ci
npm pack
npm install -g ./memorydock-2.1.0.tgz
memorydock init
memorydock service install  # Windows, run once in a normal user PowerShell
```

Use the filename printed by `npm pack` if the package version changes. See
[the full installation guide](../docs/INSTALL.md) and its
[Chinese translation](../docs/INSTALL.zh-CN.md) for platform-specific MCP
configuration, upgrades, and removal.

`init` interactively collects an OpenAI-compatible embedding provider, masks
the API-key input, tests the provider, and saves the successful configuration.
For a fully local setup, select Ollama; no API key is needed.

Open the console at `http://127.0.0.1:40889/`. It lets you review agent
proposals before they become searchable, edit approved notes, organize their
hierarchy, and export the Markdown source of truth.

## MCP client configuration

Point an MCP client at the installed command. After the MCP connection is
established, it starts the loopback Web service in the background if needed.
On Windows the service is launched by the user-owned scheduled task installed
above, so it does not inherit an agent sandbox. The task has no automatic time
or logon trigger and allows only one running instance:

```json
{
  "command": "memorydock",
  "args": ["mcp"]
}
```

For Codex, this can be installed as `codex mcp add memorydock -- memorydock
mcp`. The adapter exposes `search_memory`, `list_memories`, `propose_memory`,
`push_memory`, and `update_memory`. `list_memories` returns approved entries in
pages of up to 100 and includes the total entry count for retrieving subsequent pages.

On Windows, point clients at `node.exe` and the absolute path to the installed
`memorydock/dist/cli.js` when a client cannot launch npm's `.cmd` shim. Use
`npm root -g` to locate that file. The full installation guide shows the
corresponding Codex, Claude Code, and Cursor configuration. Restart clients
after changing MCP configuration.

## Commands

| Command | Purpose |
| --- | --- |
| `memorydock init` | Configure and verify embeddings interactively. |
| `memorydock serve` | Start the loopback API and management console. |
| `memorydock mcp` | Run the stdio MCP adapter. |
| `memorydock service install` | Register the Windows user task for background startup. |
| `memorydock service remove` | Remove the Windows user task. |
| `memorydock doctor` | Show safe configuration and storage diagnostics. |
| `memorydock export <directory>` | Copy Markdown notes to a portable directory. |
| `memorydock rebuild-notes --yes` | Create Markdown mirrors for existing index entries. |
| `memorydock migrate-storage --from <path> --yes` | One-time pre-2.0 index migration (stop `memorydock serve` first). |
| `memorydock reembed --yes` | Rebuild vectors after an embedding-model change. |

## Data layout and configuration

All data lives under one per-user root: `~/.memorydock`
(`C:\Users\<user>\.memorydock` on Windows).

| Path | Content |
| --- | --- |
| `~/.memorydock/config.json` | Embedding provider configuration |
| `~/.memorydock/notes/` | Canonical Markdown notes (source of truth) |
| `~/.memorydock/index/` | Derived LanceDB search index (rebuildable) |
| `~/.memorydock/backups/` | Scheduled `memory-<timestamp>.tar.gz` index backups |
| `~/.memorydock/migrations/` | One-time migration records |

Optional overrides: `MEMORYDOCK_HOME` (data root), `MEMORYDOCK_CONFIG_PATH`,
`MEMORYDOCK_NOTES_PATH`, `MEMORYDOCK_INDEX_PATH`. All paths are absolute and
independent of the working directory. There are no legacy environment
variables in 2.x.

On Windows, the scheduled task has its own environment. If you use custom
`MEMORYDOCK_*` paths, `PORT`, `HOST`, or embedding overrides, start
`memorydock serve` yourself from an environment with the same settings.
`MEMORYDOCK_LAUNCH_MODE=off` disables
background launch; `direct` permits the older child-process launch, which can
inherit an agent sandbox. The default is `task` on Windows and `direct` on
macOS/Linux.

`EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, and
`EMBEDDING_DIM` override the saved embedding configuration.

## Pre-2.0 migration

If you used a pre-2.0 build, stop `memorydock serve`, then run:

```bash
memorydock migrate-storage --from <old-index-directory> --yes
```

The migrator snapshots the source into `~/.memorydock/backups/pre-v2-<stamp>/`,
renames the legacy LanceDB tables, regenerates Markdown notes, and writes a
migration record. It refuses to merge a source that contains both legacy and
current tables.
