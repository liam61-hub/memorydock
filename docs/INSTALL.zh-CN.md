# 从 GitHub 安装 MemoryDock

[English](INSTALL.md) · [项目介绍](../README.zh-CN.md)

## 安装条件

- Windows、macOS 或 Linux；安装 Git、npm 和 Node.js 22 或 24 LTS。
- 准备向量模型服务：本地 [Ollama](https://ollama.com/) 或 OpenAI 兼容 API。本地版不需要 MemoryDock 账号或令牌。

使用 Ollama 时，先拉取向量模型：

```sh
ollama pull nomic-embed-text
```

## 从源码构建并安装

在终端运行以下命令，PowerShell 也可使用。当前通过 GitHub 源码分发，不要从旧 npm 仓库安装同名包。

```sh
git clone https://github.com/liam61-hub/memorydock.git
cd memorydock/server
npm ci
npm pack
npm install -g ./memorydock-2.0.0.tgz
memorydock init
memorydock doctor
```

`npm pack` 会构建管理界面和命令行，并输出实际生成的包文件名。版本变化时，在安装命令中改用该文件名。Windows 也可写成 `npm install -g .\memorydock-2.0.0.tgz`。

执行 `memorydock init` 时选择 `ollama`、`openai` 或 `compatible`，再填写模型和真实的向量维度。命令会发出测试请求，只有返回维度匹配才保存配置。使用云端服务时，待向量化的文本会发送给该服务；使用 Ollama 可在本机完成计算。

运行 `memorydock serve`，然后打开 <http://127.0.0.1:40889/>。关闭运行该命令的终端会停止前台服务。MCP 客户端执行 `memorydock mcp` 时也可按需启动本地服务。

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

如果客户端仍连接旧版本，检查 `npm root -g` 下的安装文件，并重新安装刚打包的文件。如果服务启动失败，在终端运行 `memorydock serve` 查看错误。不要把无认证的本地 API 绑定到公网地址。
