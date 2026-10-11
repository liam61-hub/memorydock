// MemoryDock site i18n — default English (the HTML markup itself), other
// languages via data-i18n / data-i18n-html / data-i18n-attr keys.
// Zero dependencies, zero third-party requests.
//
// Language resolution order: ?lang= URL parameter > localStorage > English.
// Switching languages navigates to the same page with ?lang= set (hash
// preserved); a language restored from localStorage is reflected into the
// URL via history.replaceState without a reload.
//
// Adding a language: add one entry to LANGUAGES below, one dict, and the
// matching <option> in the .lang-select dropdown of each HTML page.
(function () {
  'use strict';

  var STORAGE_KEY = 'memorydock-lang';

  // Keys used by js/main.js that have no markup anchor.
  var EN_EXTRA = { 'common.copied': 'Copied' };

  var ZH = {
    // ---- common / nav / lang ----
    'common.skip': '跳至正文',
    'common.navlabel': '主导航',
    'common.copy': '复制',
    'common.copied': '已复制',
    'nav.home': '首页',
    'nav.quickstart': '快速开始',
    'nav.faq': '常见问题',

    // ---- meta ----
    'meta.index.title': 'MemoryDock — 你的记忆属于你自己，不属于任何单一工具',
    'meta.index.desc': 'MemoryDock 给你机器上的每一个 AI 代理一份共享的私有记忆。本地优先、MCP 原生、自带密钥。免费。',
    'meta.qs.title': '快速开始 — MemoryDock',
    'meta.qs.desc': '在本地运行 MemoryDock，接入你自己的 embedding 供应商，让 Claude Code、Codex、Cursor 及任何 MCP 客户端共享同一份记忆。',
    'meta.faq.title': '常见问题 — MemoryDock',
    'meta.faq.desc': '定价、隐私、自带密钥、与 mem0 和 Letta 的对比、版本与兼容性。',
    'meta.p404.title': '404 — MemoryDock',
    'meta.p404.desc': '页面不存在。',

    // ---- footer ----
    'footer.tagline': '面向 AI 代理的本地优先记忆。你的笔记本，你的机器，你的密钥。',
    'footer.product': '产品',
    'footer.how': '工作原理',
    'footer.status': '状态',
    'footer.statusLines': 'GitHub 开源<br>从源码安装',
    'footer.trust': '没有网络字体、追踪器或第三方脚本。',
    'footer.copyright': '© <span data-year>2026</span> MemoryDock。Apache-2.0 许可。',

    'github.h2': '从 GitHub 获取 MemoryDock。',
    'github.lede': '阅读源码、本地安装，并向项目反馈意见。',
    'github.cta': '打开仓库',

    // ---- index hero ----
    'hero.badge1': '本地优先',
    'hero.badge2': 'MCP 原生',
    'hero.badge3': '免费',
    'hero.h1': '你的记忆属于<em>你自己</em>，不属于任何单一工具。',
    'hero.lede': 'MemoryDock 让电脑上的 AI 代理共享同一份记忆。Claude Code、Codex 和 Cursor 读写磁盘上的相同笔记。无需 MemoryDock 账号或云服务；向量模型可选本地或云端服务。',
    'hero.cta1': '在 GitHub 查看',
    'hero.cta2': '看看怎么用',
    'hero.status': '已在 GitHub 开源，可从源码安装',

    // ---- index why ----
    'why.head': '每个工具各记各的——彼此不相通。',
    'why.p1mark': '// 痛点一',
    'why.p1h': '你的代理彼此失忆',
    'why.p1': 'Claude Code 周一学到的东西，到周四 Cursor 从零开始。每次会话都从遗忘开始，而且每个工具忘的是自己的那一份。',
    'why.p2mark': '// 痛点二',
    'why.p2h': '你的记忆躺在别人的云端',
    'why.p2': '对话、决策、上下文——堆积在你无法读取、无法导出、无法自主删除的厂商孤岛里。',
    'why.p3mark': '// 痛点三',
    'why.p3h': '你的笔记对代理不可读',
    'why.p3': '你可以把东西写下来，但没有任何笔记文件能在任务中途回答问题。代理需要可以查询的记忆。',
    'why.answer': '<strong>一本笔记本，存在你的机器上，通过 MCP 对话。</strong>这就是 MemoryDock。',

    // ---- index modes ----
    'modes.head': '只有一种版本，永远属于你。',
    'modes.1h': '单机、开源',
    'modes.1badge': '现在',
    'modes.1': '一台机器，你所有的代理，你拥有的文件。这是唯一的版本——没有云端版，也没有付费等级。',

    // ---- index features ----
    'features.head': '像工具一样构建，而不是平台。',
    'features.1h': '默认本地优先',
    'features.1': 'Markdown 笔记保存在你的磁盘上，本地 LanceDB 索引使它们可检索。',
    'features.2h': '自带密钥',
    'features.2': 'OpenAI、together.ai，或 Ollama 实现零外呼。我们永远看不到你的数据。',
    'features.3h': '一份记忆，多个代理',
    'features.3': '任何 MCP 客户端读写同一本笔记本，没有按工具隔离的孤岛。',
    'features.4h': '像记忆一样的搜索',
    'features.4': '语义 + 关键词混合检索，长内容自动分块，细节始终找得到。',
    'features.5h': '无账号，无锁定',
    'features.5': '无需注册，无需订阅，没有导出陷阱。就是你已经拥有的本地文件。',
    'features.6h': '免费开源',
    'features.6': 'Apache-2.0 许可证免费开源，没有付费等级。',

    // ---- index how ----
    'how.head': '三步拥有共享记忆。',
    'how.1h': '运行服务',
    'how.1': '在你的机器上执行一条命令。它会在 ~/.memorydock 下创建本地笔记本——Markdown 笔记加一个可重建的检索索引。',
    'how.2h': '把代理指向它',
    'how.2': '每个客户端几行 MCP 配置。你用的所有工具共享同一本笔记本。',
    'how.3h': '让它记住',
    'how.3': '你的代理保存重要的东西。之后，任何代理都能提问并得到答案。',

    // ---- index install / compare teaser ----
    'install.head': '从 GitHub 源码安装。',
    'install.after': '完整教程——每个客户端、每种供应商——见<a href="quickstart.html">快速开始页</a>。',
    'compare.teaser': '这和 mem0、Letta 或你的代理自带记忆有什么不同？<a href="faq.html">阅读 FAQ →</a>',

    // ---- quickstart ----
    'qs.h1': '快速开始',
    'qs.lede': '在本地运行 MemoryDock，接入你自己的 embedding 供应商，让机器上的每一个代理共享它。',
    'qs.calloutTop': '<strong>MemoryDock 已在 GitHub 开源。</strong>可使用下方命令从源码安装。不同系统的 MCP 配置见<a href="https://github.com/liam61-hub/memorydock/blob/main/docs/INSTALL.zh-CN.md">完整安装指南</a>。',
    'qs.beforeHead': '开始之前',
    'qs.before1h': 'Node.js 22 或 24 LTS、npm 和 Git',
    'qs.before1': '克隆 GitHub 仓库，在本地打包后全局安装。',
    'qs.before2h': '一个 embedding 端点',
    'qs.before2': '任何 OpenAI 兼容 API。或本地 Ollama 模型——零外呼。',
    'qs.before3h': '大约五分钟',
    'qs.before3': '启动服务，粘贴三段配置，让代理记点东西。',
    'qs.providerHead': '选择你的 embedding 供应商',
    'qs.prov1': '默认选项。一个密钥，一个模型，完事。',
    'qs.prov2h': 'Ollama —— 零外呼',
    'qs.prov2': '完全本地。任何东西都不会离开你的机器。',
    'qs.prov3h': '任何 OpenAI 兼容',
    'qs.prov3': 'together.ai、公司网关，任何会说这套协议的都行。',
    'qs.provBase': '接口地址',
    'qs.provModel': '模型',
    'qs.provDim': '维度',
    'qs.provPull': '拉取',
    'qs.provKey': '密钥',
    'qs.provKeyVal': 'ollama（任意值）',
    'qs.provYours': '你的',
    'qs.provDimMatch': '必须与模型一致',
    'qs.dimWarn': '<strong>维度必须与模型一致。</strong>不匹配会在启动时被捕获，报错会指向 reembed 命令——见下方<a href="#reembed">更换模型</a>。',
    'qs.step1Head': '第 1 步 —— 启动服务',
    'qs.keyNote': '<strong>无需 MemoryDock 账号或令牌。</strong>服务只监听回环地址，笔记保存在 <code>~/.memorydock</code> 下。云端向量服务可能需要它自己的 API Key。',
    'qs.step2Head': '第 2 步 —— 连接你的代理',
    'qs.cursorLabel': 'Cursor → 设置 → MCP',
    'qs.npxWarn': '<strong>全局安装并使用裸命令。</strong><code>npx</code> 每次冷启动都会重新解析 registry——这是 MCP 连接时好时坏的已知原因。',
    'qs.reconnect': '<strong>改完配置后重启客户端会话。</strong>通过客户端的 MCP 工具列表确认连接成功。',
    'qs.anyClient': '<strong>支持 stdio MCP 客户端。</strong>这些示例都运行已安装的 <code>memorydock mcp</code> 命令。',
    'qs.step3Head': '第 3 步 —— 验证',
    'qs.ask': '然后让你的代理试试：',
    'qs.ask1h': '保存点东西',
    'qs.ask1': '「把这个存到我的记忆里：staging 部署用的是 Node 20，不是 22。」',
    'qs.ask2h': '从另一个工具里回忆',
    'qs.ask2': '「在我的记忆里搜一下 staging 用的是哪个 Node 版本。」',
    'qs.toolsHead': '你的代理会获得什么',
    'qs.toolsSub': '工具',
    'qs.resSub': '资源',
    'qs.colTool': '工具',
    'qs.colRes': '资源',
    'qs.colVar': '变量',
    'qs.colDefault': '默认值',
    'qs.colNotes': '说明',
    'qs.colWhat': '作用',
    'qs.t1': '语义 + 关键词混合检索你的记忆',
    'qs.t8': '提议一条记忆供人审阅（批准前不可检索）',
    'qs.t9': '分页列出已批准的记忆',
    'qs.t2': '存储内容（按标题去重的 upsert）',
    'qs.t3': '更新已有条目，支持安全追加',
    'qs.t4': '列出已导入的项目',
    'qs.t5': '获取单个项目详情',
    'qs.t6': '列出有效的内容类型',
    'qs.t7': '查询个人信息条目',
    'qs.r1': '全部项目，以 MCP 资源形式',
    'qs.r2': '按名称获取单个项目',
    'qs.r3': '个人信息条目',
    'qs.r4': '以资源形式返回搜索结果',
    'qs.envHead': '环境变量',
    'qs.envServerSub': '服务端（<code>.env</code>）',
    'qs.envMcpSub': 'MCP 客户端',
    'qs.e1': '单机使用请保持 localhost',
    'qs.e2': '每用户数据根目录（配置、笔记、索引、备份）',
    'qs.e3': 'LanceDB 索引目录',
    'qs.e4': '规范化的 Markdown 笔记',
    'qs.e5': '<span class="warn">搜索必需</span> —— OpenAI 兼容端点',
    'qs.e6': '服务商要求时填写；本地 Ollama 可留空',
    'qs.e7': 'Ollama 可用 <code>bge-m3</code>',
    'qs.e8': '必须与模型输出维度一致',
    'qs.e9': 'embedding 调用重试次数',
    'qs.e10': '可选 —— 仅用于项目导入摘要',
    'qs.e12': 'Pino 日志级别',
    'qs.e13': '设为 <code>true</code> 跳过启动探测',
    'qs.m1': 'MemoryDock 服务地址',
    'qs.m2': '可选 —— 仅当服务端要求时填写',
    'qs.reembedHead': '更换 embedding 模型',
    'qs.reembedIntro': '换成不同维度的模型需要重建全部向量。先备份，再原子重建——中途失败也不会动你现有的数据。',
    'qs.dataHead': '你的数据在哪里',
    'qs.data1': '可重建的 LanceDB 检索索引——由你的笔记派生。',
    'qs.data2': '滚动 <code>memory-*.tar.gz</code> 备份，加上 <code>reembed --backup</code> 产生的部分。',
    'qs.data3': '规范化的 Markdown 笔记——唯一的真相来源。备份 = 复制整个文件夹。抹除一切 = 删除它。',

    // ---- faq ----
    'faq.lede': '关于定价、隐私、密钥，以及 MemoryDock 与替代方案的对比，这里有直接的回答。',
    'faq.gPricing': '定价',
    'faq.q1': 'MemoryDock 免费吗？',
    'faq.a1': '免费。MemoryDock 以 Apache-2.0 许可证开源。',
    'faq.q2': '为什么免费提供？',
    'faq.a2': '说实话：我们更愿意公开构建，弄清楚人们真正需要什么，而不是躲在付费墙后面猜。项目以 Apache-2.0 许可证开源，已发布的一切保持免费。',
    'faq.gPrivacy': '隐私与数据',
    'faq.q3': '我的数据存在哪里？',
    'faq.a3': '原始数据是电脑上 <code>~/.memorydock/notes/</code> 中的 Markdown 笔记，LanceDB 检索索引由笔记派生。MemoryDock 没有云数据库或账号。',
    'faq.q4': 'MemoryDock 会把我的数据发到别处吗？',
    'faq.a4': '只会发给<em>你自己</em>的 embedding 供应商，用<em>你自己的</em>密钥——因为向量总得在某个地方算出来。选 Ollama 就什么都不离开你的机器。MemoryDock 本身没有账号、没有遥测、没有统计。',
    'faq.q5': '我能删除一切吗？',
    'faq.a5': '先导出想保留的内容，再卸载程序并删除本地数据目录。MemoryDock 不保存远程副本。',
    'faq.q6': '你们追踪这个网站吗？',
    'faq.a6': '网站没有统计、Cookie、追踪器或第三方脚本。',
    'faq.gKey': '自带密钥',
    'faq.q7': '哪些 embedding 供应商可用？',
    'faq.a7': '任何 OpenAI 兼容端点。已验证：OpenAI、together.ai 和 Ollama（本地）。若遇到兼容问题，请到<a href="https://github.com/liam61-hub/memorydock/issues">GitHub Issues</a>反馈。',
    'faq.q8': '如果我的模型不是 1536 维呢？',
    'faq.a8': '把 <code>EMBEDDING_DIM</code> 设成你模型的输出维度。换模型后运行 <code>memorydock reembed --yes --backup</code> 重建全部向量——重建是原子的，失败也不会动你的数据。见<a href="quickstart.html#reembed">快速开始</a>。',
    'faq.q9': '我还需要 LLM 密钥吗？',
    'faq.a9': '不需要。LLM 密钥可选，且只用于一个功能：导入项目时生成摘要。不配置时 MemoryDock 回退到 README 片段——其他一切照常工作。',
    'faq.gCompare': '与……对比',
    'faq.compareAsOf': '截至 2026 年 9 月。这些都是好工具——只是各自优化了不同的东西。',
    'faq.cBuiltin': '代理内置记忆',
    'faq.cWhat': '它是什么',
    'faq.cWhere': '数据在哪里',
    'faq.cCross': '跨代理工具共享',
    'faq.cAccount': '需要账号',
    'faq.cExternal': '默认外呼',
    'faq.cSelf': '可自托管',
    'faq.c1what': '面向代理的本地记忆服务',
    'faq.c2what': 'AI 应用的记忆层',
    'faq.c3what': '有状态的代理框架',
    'faq.c4what': '产品内的记忆',
    'faq.c1where': '你的磁盘',
    'faq.c2where': '他们的云，或自托管 OSS',
    'faq.c3where': '你的服务器',
    'faq.c4where': '厂商的云',
    'faq.c1cross': '是——一个 MCP 服务，任何客户端',
    'faq.c2cross': '通过他们的 SDK',
    'faq.c3cross': '通过他们的 SDK / API',
    'faq.c4cross': '否——锁定在单个产品内',
    'faq.c1acc': '否',
    'faq.c2acc': '是（云端）',
    'faq.c3acc': '否（自托管）',
    'faq.c4acc': '是',
    'faq.c1ext': '用 Ollama 零外呼；其他自带密钥',
    'faq.c2ext': '是（云端）',
    'faq.c3ext': '可配置',
    'faq.c4ext': '是',
    'faq.c1self': '是——这正是全部意义所在',
    'faq.c2self': '是（开源版）',
    'faq.c3self': '是',
    'faq.c4self': '否',
    'faq.compareNote': '如果比较信息有误，请到<a href="https://github.com/liam61-hub/memorydock/issues">GitHub Issues</a>指出。',
    'faq.gMulti': '多代理与共享',
    'faq.q10': '多个代理能共享一份记忆吗？',
    'faq.a10': '能——这正是核心用法。你机器上一个 MemoryDock 服务，每个 MCP 客户端（Claude Code、Codex、Cursor 或任何其他）读写同一本笔记本。',
    'faq.q11': '我和队友能共享一份记忆吗？',
    'faq.a11': '不行——它刻意只服务单机。MemoryDock 只有一种版本，数据就留在你的电脑上。',
    'faq.gRoadmap': '版本',
    'faq.q12': '还有其他版本吗？',
    'faq.a12': '没有。MemoryDock 只有一种版本：单机开源包，没有其他可购买或运行的版本。',
    'faq.q13': '会有云端版本吗？',
    'faq.a13': '没有相关计划。本地优先是身份，不是阶段。',
    'faq.q14': '如何安装 MemoryDock？',
    'faq.a14': '克隆<a href="https://github.com/liam61-hub/memorydock">GitHub 仓库</a>，按<a href="quickstart.html">源码安装指南</a>操作。项目通过 GitHub 源码分发。',
    'faq.gCompat': '兼容性',
    'faq.q15': '哪些客户端可用？',
    'faq.a15': '任何会说 MCP 的客户端。目前测试过 Claude Code、Codex CLI 和 Cursor；兼容问题请到<a href="https://github.com/liam61-hub/memorydock/issues">GitHub Issues</a>反馈。',
    'faq.q16': 'Windows、macOS、Linux？',
    'faq.a16': '支持 Windows、macOS 和 Linux，要求 Node.js 22 或 24 LTS。Windows 的 MCP 路径配置见安装指南。',
    'faq.q17': '能离线工作吗？',
    'faq.a17': '用 Ollama 完全可以——服务、向量化、代理都能在没有网络的情况下运行。用托管供应商时，只有 embedding 调用需要网络。',
    'faq.gMisc': '其他',
    'faq.q18': 'MemoryDock 开源吗？',
    'faq.a18': '是。MemoryDock 源码在 GitHub 公开，采用 Apache-2.0 许可证。你的笔记仍是自己拥有的 Markdown 文件。',
    'faq.q19': '怎么报告 bug 或提需求？',
    'faq.a19': '请在<a href="https://github.com/liam61-hub/memorydock/issues">GitHub 仓库</a>提交 Issue。安全漏洞请按照安全政策私下报告，不要公开漏洞细节。',

    // ---- 404 ----
    'p404.h1': '这个页面不存在——但你的记忆存在。',
    'p404.p': '从 GitHub 安装后，你的记忆仍在你的电脑上。',
    'p404.back': '返回 MemoryDock'
  };

  // Language registry — the .lang-select <option> lists in each HTML page
  // must stay in sync with this.
  var LANGUAGES = [
    { code: 'en', label: 'English', htmlLang: 'en' },
    { code: 'zh', label: '中文', htmlLang: 'zh-CN' }
  ];
  var DICTS = { zh: ZH }; // 'en' is the HTML markup itself

  function isKnown(code) {
    return LANGUAGES.some(function (l) { return l.code === code; });
  }

  function htmlLangOf(lang) {
    var found = LANGUAGES.find(function (l) { return l.code === lang; });
    return found ? found.htmlLang : 'en';
  }

  function resolveLang() {
    try {
      var q = new URLSearchParams(location.search).get('lang');
      if (q && isKnown(q)) return q;
      var s = localStorage.getItem(STORAGE_KEY);
      if (s && isKnown(s)) return s;
    } catch (e) { /* storage unavailable */ }
    return 'en';
  }

  var current = 'en';

  // Original English text is cached from the markup on first apply, so EN
  // never has to be duplicated in this file.
  var enCache = {};
  var attrCache = {};

  function setYear() {
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  function updateSelect() {
    document.querySelectorAll('.lang-select').forEach(function (sel) {
      if (sel.querySelector('option[value="' + current + '"]')) sel.value = current;
    });
  }

  function apply(lang) {
    current = lang;

    document.querySelectorAll('[data-i18n], [data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n') || el.getAttribute('data-i18n-html');
      var isHtml = el.hasAttribute('data-i18n-html');
      if (!(key in enCache)) {
        enCache[key] = isHtml ? el.innerHTML : el.textContent;
      }
      var value = lang === 'en' ? enCache[key] : (DICTS[lang] || {})[key];
      if (value === undefined) {
        if (lang !== 'en') console.warn('[i18n] missing ' + lang + ' translation for key: ' + key);
        return;
      }
      if (isHtml) el.innerHTML = value; else el.textContent = value;
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      var spec = el.getAttribute('data-i18n-attr'); // "attr:key"
      var idx = spec.indexOf(':');
      var attr = spec.slice(0, idx);
      var key = spec.slice(idx + 1);
      if (!(key in attrCache)) attrCache[key] = el.getAttribute(attr) || '';
      var value = lang === 'en' ? attrCache[key] : (DICTS[lang] || {})[key];
      if (value === undefined) {
        if (lang !== 'en') console.warn('[i18n] missing ' + lang + ' translation for attr key: ' + key);
        return;
      }
      el.setAttribute(attr, value);
    });

    document.documentElement.lang = htmlLangOf(lang);
    updateSelect();
    setYear(); // footer copyright may have been re-created via innerHTML

    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
  }

  function initialize() {
    document.querySelectorAll('.lang-select').forEach(function (sel) {
      sel.addEventListener('change', function () {
        // Keep the selected language in the URL without an unnecessary reload.
        var url = new URL(location.href);
        url.searchParams.set('lang', sel.value);
        history.pushState(null, '', url.toString());
        apply(sel.value);
      });
    });

    var lang = resolveLang();
    apply(lang);

    // A language restored from localStorage is reflected into the URL
    // without a reload, so the address bar always matches the content.
    var url = new URL(location.href);
    if (!url.searchParams.has('lang') && lang !== 'en') {
      url.searchParams.set('lang', lang);
      history.replaceState(null, '', url.toString());
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();

  window.MEMORYDOCK_I18N = {
    lang: function () { return current; },
    t: function (key) {
      var dict = DICTS[current] || {};
      if (dict[key] !== undefined) return dict[key];
      if (key in enCache) return enCache[key];
      if (key in EN_EXTRA) return EN_EXTRA[key];
      return key;
    }
  };
})();
