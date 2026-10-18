# 从 GitHub 安装 MemoryDock

[English](INSTALL.md) · [项目介绍](../README.zh-CN.md)

## 安装条件

- Windows、macOS 或 Linux；安装 Git、npm 和 Node.js 22 或 24 LTS。
- 准备向量模型服务：本地 [Ollama](https://ollama.com/) 或 OpenAI 兼容 API。MemoryDock 不需要账号或令牌。

使用 Ollama 时，先拉取向量模型：

```sh
ollama pull nomic-embed-text
```

## 从源码构建并安装

在终端运行以下命令，PowerShell 也可使用。项目通过 GitHub 源码分发。

```sh
git clone https://github.com/liam61-hub/memorydock.git
cd memorydock/server
npm ci
npm pack
npm install -g ./memorydock-2.1.1.tgz
memorydock init
memorydock doctor
```

`npm pack` 会构建管理界面和命令行，并输出实际生成的包文件名。版本变化时，在安装命令中改用该文件名。Windows 也可写成 `npm install -g .\memorydock-2.1.1.tgz`。

执行 `memorydock init` 时选择 `ollama`、`openai` 或 `compatible`，再填写模型和真实的向量维度。命令会发出测试请求，只有返回维度匹配才保存配置。使用云端服务时，待向量化的文本会发送给该服务；使用 Ollama 可在本机完成计算。

Windows 用户在正常用户权限的 PowerShell 中执行一次 `memorydock service install`。该命令注册一个没有登录或定时触发器的用户任务。AI 客户端连接 MCP 时，如服务尚未运行，便通过此任务在后台启动服务；多个客户端共用一个服务。工具会立即显示，启动期间发出的工具调用最多等待 30 秒，支持进度通知的客户端会收到提示。

也可在终端运行 `memorydock serve`，然后打开 <http://127.0.0.1:40889/>。关闭终端会停止这个前台服务。如果计划任务缺失或受限客户端无法触发它，请在正常用户终端启动服务；不要以管理员身份运行。

## 向量模型配置

`memorydock init` 会先发送测试请求，只有返回维度与所填一致时才把配置保存到 `~/.memorydock/config.json`。以下三种方案均已验证：

| 提供方 | Base URL | 模型 | 维度 | API Key |
| --- | --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `text-embedding-3-small` | `1536` | 你的 OpenAI Key |
| Ollama（本地） | `http://127.0.0.1:11434/v1` | `nomic-embed-text` | `768` | 任意值，如 `ollama` |
| OpenAI 兼容服务 | 你的端点 | 你的模型 | 必须与模型一致 | 按服务要求 |

使用 Ollama 前先执行 `ollama pull nomic-embed-text`；`bge-m3`（1024 维）也是常见选择。使用云端服务时，待向量化的文本会发送给该服务；使用 Ollama 可在本机完成计算。

环境变量可以覆盖已保存的配置：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `EMBEDDING_BASE_URL` | 已保存的值 | OpenAI 兼容端点 |
| `EMBEDDING_API_KEY` | 已保存的值 | 服务方密钥；本地 Ollama 留空 |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | 模型名，Ollama 可填 `bge-m3` |
| `EMBEDDING_DIM` | `1536` | 必须与模型实际输出维度一致 |
| `EMBEDDING_MAX_RETRIES` | `3` | 向量请求重试次数 |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | — | 可选，仅项目导入摘要使用 |

已保存的维度必须与模型实际输出一致，不匹配时服务启动会报错。更换不同维度的模型前，先备份 `notes/`，再重建全部向量：

```sh
memorydock reembed --yes --backup
```

重建会先对所有笔记重新嵌入，再原子性替换索引；中途失败不会影响现有索引。

## 连接 MCP 客户端

修改 MCP 配置后重启客户端。stdio 入口为安装后的 `memorydock mcp` 命令。

### Codex

macOS 和 Linux：

```sh
codex mcp add memorydock -- memorydock mcp
codex mcp list
```

Windows 上，部分 MCP 客户端无法直接启动 npm 的 `.cmd` 包装文件。用 `where node` 找到 `node.exe`，用 `npm root -g` 找到全局包目录，再在 `~/.codex/config.toml` 中填写绝对路径。**TOML 中的 Windows 路径使用单引号**：

```toml
[mcp_servers.memorydock]
command = 'C:\path\to\node.exe'
args = ['C:\path\to\node_modules\memorydock\dist\cli.js', 'mcp']
```

将示例路径换成你电脑上的真实路径。CLI 文件位置是 `<npm root -g>\memorydock\dist\cli.js`。Codex 的 `/mcp` 可以列出本次会话可用的服务器和工具；在任务中点名 MemoryDock 即可指定使用它。

### Claude Code

macOS 和 Linux：

```sh
claude mcp add --transport stdio --scope user memorydock -- memorydock mcp
claude mcp get memorydock
```

Windows 上同样建议把 `node.exe` 的绝对路径设为命令，把已安装的 `cli.js` 路径和 `mcp` 设为参数。JSON 配置中的反斜杠需要转义，也可以改用正斜杠。修改后重新连接客户端。

### Cursor 与其他 stdio 客户端

macOS 和 Linux 可以在客户端 MCP 设置中加入：

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

Windows 上将 `command` 改为 `node.exe` 的绝对路径，并将 `args` 设为 `cli.js` 的绝对路径及 `mcp`。

## 验证安装

运行 `memorydock --version` 和 `memorydock doctor`。在 Agent 客户端中确认能看到 `search_memory`、`list_memories`、`propose_memory`、`push_memory`、`update_memory`。让 Agent 提议一条测试记忆，在网页管理界面批准后，再用 `list_memories` 或 `search_memory` 找到它。建议使用可在测试结束后删除的临时内容。

## 数据、升级与卸载

默认数据目录是 `~/.memorydock/`，Windows 上对应 `C:\Users\<用户名>\.memorydock`。其中包含 `config.json`、原始 `notes/`、派生 `index/` 和备份。若要更换位置，请在初始化前将 `MEMORYDOCK_HOME` 设为绝对路径。升级或更换向量模型前请备份 `notes/`。

升级时，在克隆目录中运行 `git pull`，然后重新执行 `npm ci`、`npm pack` 和 `npm install -g`，安装新的包文件，最后重启服务及 MCP 客户端。卸载程序可运行 `npm uninstall -g memorydock`；这不会删除笔记。确认已经导出或备份后，才删除 `~/.memorydock/`。

Windows 上卸载前先运行 `memorydock service remove`。如果升级后 Node.js 或包路径改变，应重新安装计划任务。该任务使用独立环境，不继承 MCP 客户端中的自定义 `MEMORYDOCK_*` 路径、`PORT`、`HOST` 及向量配置环境变量；使用自定义设置时，请在带相同变量的终端运行 `memorydock serve`。`MEMORYDOCK_LAUNCH_MODE=off` 可关闭后台启动；`direct` 使用旧的子进程启动方式，可能继承 Agent 沙箱。Windows 默认为 `task`，macOS/Linux 默认为 `direct`。

如果客户端仍连接旧版本，检查 `npm root -g` 下的安装文件，并重新安装刚打包的文件。如果服务启动失败，在终端运行 `memorydock serve` 查看错误。不要把无认证的本地 API 绑定到公网地址。
