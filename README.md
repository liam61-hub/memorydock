# MemoryDock

[简体中文](README.zh-CN.md) · [Installation](docs/INSTALL.md) · [License](LICENSE)

MemoryDock is local-first memory for AI agents. Codex, Claude Code, Cursor, and other MCP clients can search and save notes in one notebook on your computer. You review agent-proposed memories before they become searchable. Markdown files are the source of truth; a local LanceDB index supports search.

MemoryDock saves note bodies exactly as submitted. Plain text is valid Markdown, but headings and lists appear only when the agent or editor includes Markdown syntax. The console displays both structured Markdown and older plain-text notes. Its memory list uses preview cards, and the console opens in English by default with a persistent English/Chinese language switch.

MemoryDock runs on one computer, listens on loopback, and needs no account. Embeddings can run locally with Ollama or through an OpenAI-compatible provider you configure. Hosted embedding providers receive the text sent for embedding.

## Install from GitHub

Requirements: Node.js 22 or 24 LTS, npm, Git, and an embedding provider. For a fully local setup, install Ollama and pull `nomic-embed-text` first.

```sh
git clone https://github.com/liam61-hub/memorydock.git
cd memorydock/server
npm ci
npm pack
npm install -g ./memorydock-2.1.3.tgz
memorydock init
memorydock doctor
```

`npm pack` prints the generated filename. Use that filename if the package version differs from this example. `memorydock init` tests the embedding provider before saving its configuration. On Windows, run `memorydock service install` once from a normal user PowerShell. Connecting an MCP client then starts the local service in the background. The service and console can also be started with `memorydock serve`; open <http://127.0.0.1:40889/>.

See the [installation guide](docs/INSTALL.md) for Windows, macOS, Linux, client configuration, upgrades, and uninstalling. The [Chinese guide](docs/INSTALL.zh-CN.md) has the same steps.

## Embedding providers

`memorydock init` interactively configures the embedding provider:

- **OpenAI** — base URL `https://api.openai.com/v1`, model `text-embedding-3-small` (1536 dimensions), with your API key.
- **Ollama** — local, zero external calls: `ollama pull nomic-embed-text` (768 dimensions); the key can be any value.
- **Any OpenAI-compatible endpoint** — your base URL, model, and its real dimension.

`EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, and `EMBEDDING_DIM` override the saved configuration; `EMBEDDING_MAX_RETRIES` (default `3`) bounds retries. Switching to a model with a different dimension requires `memorydock reembed --yes --backup`. See the [installation guide](docs/INSTALL.md#embedding-provider-configuration) for the full configuration reference.

## What it does

- Shares one local notebook between MCP clients through `search_memory`, `list_memories`, `propose_memory`, `push_memory`, and `update_memory`.
- Keeps agent proposals pending until you approve them in the web console. Explicit requests to save or update a memory can write directly.
- Stores canonical notes under `~/.memorydock/notes/` and a rebuildable search index under `~/.memorydock/index/`.
- Offers Markdown export with `memorydock export <directory>`.

MemoryDock does not record full conversations. It has no account service, telemetry, or remote synchronization. It is intended for a single user on a single computer; do not expose its unauthenticated HTTP service to a network.

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
