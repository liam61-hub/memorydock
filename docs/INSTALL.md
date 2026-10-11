# Install MemoryDock from GitHub

[简体中文](INSTALL.zh-CN.md) · [Project overview](../README.md)

## Requirements

- Windows, macOS, or Linux with Git, npm, and Node.js 22 or 24 LTS.
- An embedding provider: local [Ollama](https://ollama.com/) or an OpenAI-compatible API. MemoryDock needs no account or token.

For Ollama, pull an embedding model before setup:

```sh
ollama pull nomic-embed-text
```

## Build and install

Run these commands in a terminal (PowerShell also accepts them). The project is distributed from GitHub source.

```sh
git clone https://github.com/liam61-hub/memorydock.git
cd memorydock/server
npm ci
npm pack
npm install -g ./memorydock-2.0.0.tgz
memorydock init
memorydock doctor
```

`npm pack` builds the console and CLI, then prints the tarball name. Substitute that name in the installation command if the version changes. On Windows, `npm install -g .\memorydock-2.0.0.tgz` is equivalent.

At `memorydock init`, choose `ollama`, `openai`, or `compatible`, then enter the model and its actual embedding dimension. The command sends a test request and saves the configuration only when the response matches the requested dimension. A hosted provider sees the text sent for embedding; Ollama keeps that calculation local.

Run `memorydock serve` to keep the service in a terminal and open <http://127.0.0.1:40889/>. Closing that terminal stops the foreground service. Connecting through `memorydock mcp` can start the local service on demand.

## Embedding provider configuration

`memorydock init` saves the provider settings to `~/.memorydock/config.json` only after a test request returns the dimension you entered. Three verified setups:

| Provider | Base URL | Model | Dimension | API key |
| --- | --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `text-embedding-3-small` | `1536` | Your OpenAI key |
| Ollama (local) | `http://127.0.0.1:11434/v1` | `nomic-embed-text` | `768` | Any value, e.g. `ollama` |
| OpenAI-compatible | Your endpoint | Your model | Must match the model | Per provider |

For Ollama, run `ollama pull nomic-embed-text` first; `bge-m3` (1024 dimensions) is another common local option. A hosted provider sees the text sent for embedding; Ollama keeps that calculation local.

Environment variables override the saved configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMBEDDING_BASE_URL` | saved value | OpenAI-compatible endpoint |
| `EMBEDDING_API_KEY` | saved value | Provider key; leave empty for local Ollama |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Model name, e.g. `bge-m3` for Ollama |
| `EMBEDDING_DIM` | `1536` | Must match the model's output dimension |
| `EMBEDDING_MAX_RETRIES` | `3` | Retries for embedding calls |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | — | Optional; summarization for project import only |

The stored dimension must match the model's real output dimension — a mismatch is reported at startup. To switch to a model with a different dimension, back up `notes/` first, then rebuild every vector:

```sh
memorydock reembed --yes --backup
```

The rebuild re-embeds all notes before swapping the index atomically; a failure leaves the existing index untouched.

## Connect an MCP client

Restart the client after changing its MCP configuration. The stdio entry point is the installed `memorydock mcp` command.

### Codex

On macOS and Linux:

```sh
codex mcp add memorydock -- memorydock mcp
codex mcp list
```

On Windows, some MCP clients cannot launch npm's `.cmd` shim directly. Find `node.exe` with `where node`, and the installed package directory with `npm root -g`. In `~/.codex/config.toml`, use absolute paths with **TOML single quotes**:

```toml
[mcp_servers.memorydock]
command = 'C:\path\to\node.exe'
args = ['C:\path\to\node_modules\memorydock\dist\cli.js', 'mcp']
```

Replace both example paths with the paths on your computer. The CLI file is `<npm root -g>\memorydock\dist\cli.js`. In Codex, `/mcp` lists active servers and tools; ask the agent to use MemoryDock by name.

### Claude Code

On macOS and Linux:

```sh
claude mcp add --transport stdio --scope user memorydock -- memorydock mcp
claude mcp get memorydock
```

On Windows, use `node.exe` and the installed CLI file as the command and first argument, as in the Codex example. JSON configuration requires escaped backslashes or forward slashes in paths. Reconnect the client after editing its configuration.

### Cursor and other stdio clients

Add this entry to the client's MCP settings on macOS or Linux:

```json
{
  "mcpServers": {
    "memorydock": {
      "command": "memorydock",
      "args": ["mcp"]
    }
  }
}
```

On Windows, set `command` to the absolute path to `node.exe` and set `args` to the absolute path to `cli.js` followed by `mcp`.

## Verify the installation

Run `memorydock --version` and `memorydock doctor`. In your client, confirm that `search_memory`, `list_memories`, `propose_memory`, `push_memory`, and `update_memory` are listed. Ask it to propose a test note, approve the proposal in the web console, and find it with `list_memories` or `search_memory`. Use a temporary note that you can delete afterward.

## Data, updates, and removal

The default data root is `~/.memorydock/` (`C:\Users\<user>\.memorydock` on Windows). It contains `config.json`, canonical `notes/`, derived `index/`, and backups. Set `MEMORYDOCK_HOME` to an absolute path before initialization if you want a different location. Back up `notes/` before upgrading or changing embedding models.

To update, run `git pull` in the clone, then rerun `npm ci`, `npm pack`, and `npm install -g` with the new tarball name. Restart running services and MCP clients. To remove the program, run `npm uninstall -g memorydock`; this does not remove your notes. Delete `~/.memorydock/` only after exporting or backing up anything you want to keep.

If a client connects to an old build, verify the installed file under `npm root -g` and reinstall the newly packed tarball. If the local service fails to start, run `memorydock serve` in a terminal to see the startup error. Do not bind the unauthenticated local API to a public network interface.
