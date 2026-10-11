# MemoryDock

[简体中文](README.zh-CN.md) · [Installation](docs/INSTALL.md) · [License](LICENSE)

MemoryDock is local-first memory for AI agents. Codex, Claude Code, Cursor, and other MCP clients can search and save notes in one notebook on your computer. You review agent-proposed memories before they become searchable. Markdown files are the source of truth; a local LanceDB index supports search.

The local edition runs on one computer, listens on loopback, and needs no MemoryDock account. Embeddings can run locally with Ollama or through an OpenAI-compatible provider you configure. Hosted embedding providers receive the text sent for embedding.

## Install from GitHub

Requirements: Node.js 22 or 24 LTS, npm, Git, and an embedding provider. For a fully local setup, install Ollama and pull `nomic-embed-text` first.

```sh
git clone https://github.com/liam61-hub/memorydock.git
cd memorydock/server
npm ci
npm pack
npm install -g ./memorydock-2.0.0.tgz
memorydock init
memorydock doctor
```

`npm pack` prints the generated filename. Use that filename if the package version differs from this example. `memorydock init` tests the embedding provider before saving its configuration. The service and console can be started with `memorydock serve`; open <http://127.0.0.1:40889/>. An MCP client running `memorydock mcp` starts the local service on demand.

See the [installation guide](docs/INSTALL.md) for Windows, macOS, Linux, client configuration, upgrades, and uninstalling. The [Chinese guide](docs/INSTALL.zh-CN.md) has the same steps.

## What it does

- Shares one local notebook between MCP clients through `search_memory`, `list_memories`, `propose_memory`, `push_memory`, and `update_memory`.
- Keeps agent proposals pending until you approve them in the web console. Explicit requests to save or update a memory can write directly.
- Stores canonical notes under `~/.memorydock/notes/` and a rebuildable search index under `~/.memorydock/index/`.
- Offers Markdown export with `memorydock export <directory>`.

MemoryDock does not record full conversations. The local edition has no account service, telemetry, or remote synchronization. It is intended for a single user on a single computer; do not expose its unauthenticated HTTP service to a network.

## Project layout

| Directory | Contents |
| --- | --- |
| `server/` | Local CLI, loopback API, MCP adapter, web console, and tests |
| `site/` | Static English and Chinese product site |
| `docs/` | Installation guides |

## Development

```sh
cd server
npm ci
npm run lint
npm run typecheck
npm test
npm run build:admin
npm run build
```

Bug reports and feature requests are welcome in [GitHub Issues](https://github.com/liam61-hub/memorydock/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

Licensed under [Apache-2.0](LICENSE).
