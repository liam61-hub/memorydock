# MemoryDock

[English](README.md) · [安装指南](docs/INSTALL.zh-CN.md) · [开源许可证](LICENSE)

MemoryDock 是面向 AI Agent 的本地记忆工具。Codex、Claude Code、Cursor 等 MCP 客户端可以共享同一本存放在你电脑上的笔记。Agent 提议保存的记忆需要先由你在管理界面审核。Markdown 文件是原始数据，LanceDB 本地索引用于检索。

本地版只服务于单台电脑，HTTP 服务仅监听回环地址，无需 MemoryDock 账号。向量计算可使用本地 Ollama，也可使用你自行配置的 OpenAI 兼容服务；使用云端向量服务时，待向量化的文本会发送给该服务。

## 从 GitHub 安装

需要 Node.js 22 或 24 LTS、npm、Git，以及一个向量模型服务。如果希望完全本地运行，可先安装 Ollama 并拉取 `nomic-embed-text`。

```sh
git clone https://github.com/liam61-hub/memorydock.git
cd memorydock/server
npm ci
npm pack
npm install -g ./memorydock-2.0.0.tgz
memorydock init
memorydock doctor
```

`npm pack` 会输出实际生成的文件名；版本不同时，请在安装命令中使用该文件名。`memorydock init` 会先验证向量服务，再保存配置。运行 `memorydock serve` 后可打开 <http://127.0.0.1:40889/>。MCP 客户端启动 `memorydock mcp` 时也会按需启动本地服务。

Windows、macOS、Linux 安装及各 Agent 的连接方法见[中文安装指南](docs/INSTALL.zh-CN.md)，英文版本见 [Installation](docs/INSTALL.md)。

## 主要功能

- 通过 `search_memory`、`list_memories`、`propose_memory`、`push_memory` 和 `update_memory` 在多个 MCP 客户端之间共享记忆。
- Agent 自行提议的记忆需先审核；你明确要求保存或修改时可以直接写入。
- 原始笔记保存在 `~/.memorydock/notes/`，可重建的检索索引保存在 `~/.memorydock/index/`。
- 可用 `memorydock export <目录>` 导出 Markdown。

MemoryDock 不录制完整对话。本地版没有账号服务、遥测或远程同步，面向单用户单机使用；请勿将无认证的 HTTP 服务暴露到网络。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `server/` | 本地命令行、回环 API、MCP 适配器、管理界面及测试 |
| `site/` | 中英文静态产品网站 |
| `docs/` | 安装指南 |

## 参与开发

```sh
cd server
npm ci
npm run lint
npm run typecheck
npm test
npm run build:admin
npm run build
```

欢迎通过 [GitHub Issues](https://github.com/liam61-hub/memorydock/issues) 反馈问题和建议。参与贡献请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；报告安全问题请阅读 [SECURITY.md](SECURITY.md)。

项目采用 [Apache-2.0](LICENSE) 许可证。
