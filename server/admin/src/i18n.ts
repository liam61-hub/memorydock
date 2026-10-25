export type Language = 'en' | 'zh';

const english = {
  '笔记': 'Note', '文档': 'Document', '文章': 'Article', '项目': 'Project', '个人资料': 'Personal info',
  '首页概览': 'Overview', '本地记忆库的运行概况与最近更新': 'Your local memory at a glance',
  '搜索浏览': 'Browse memories', '搜索、筛选和管理已入库的记忆': 'Search, filter, and manage saved memories',
  '新建记忆条目': 'New memory', '用 Markdown 沉淀可搜索的长期记忆': 'Create a searchable, lasting memory',
  '项目列表': 'Projects', '集中浏览已索引的项目记忆': 'Browse indexed project memories',
  '审核收件箱': 'Review inbox', '确认代理提交的候选记忆后再进入搜索': 'Approve agent proposals before they appear in search',
  '记忆地图': 'Memory map', '按父子关系查看记忆结构': 'Explore relationships between memories',
  '条目详情': 'Memory details', '专注阅读已沉淀的 Markdown 内容': 'Read your saved content',
  '暂无标签': 'No tags', '标题和内容不能为空。': 'Title and content are required.',
  '条目已更新。': 'Memory updated.', '条目已创建并建立索引。': 'Memory created and indexed.',
  '条目已归档。': 'Memory archived.', '条目已恢复。': 'Memory restored.',
  'Markdown 已复制到剪贴板。': 'Markdown copied to clipboard.',
  '复制失败，请检查浏览器的剪贴板权限。': 'Copy failed. Check your browser clipboard permissions.',
  '工作台': 'Workspace', '记忆库': 'Memory library', '新建条目': 'New memory',
  '暂无记忆条目': 'No memories yet', '已归档': 'Archived', '使用中': 'Active',
  '编辑': 'Edit', '归档': 'Archive', '恢复': 'Restore', '删除': 'Delete',
  '新建条目，或调整搜索与筛选条件后再试。': 'Create a memory or adjust your search and filters.',
  '打开菜单': 'Open menu', '关闭菜单': 'Close menu', '本地记忆管理台': 'Local memory console',
  '管理菜单': 'Management menu', '本地私有存储': 'Private local storage',
  '数据保存在你的设备上': 'Your data stays on your device', '编辑记忆条目': 'Edit memory',
  '刷新': 'Refresh', '关闭提示': 'Dismiss message',
  '记忆总量': 'Total memories', '已批准并可搜索': 'Approved and searchable',
  '本地私有工作区': 'Your private local workspace',
  '笔记保存在本机，代理提议需经你批准后才会进入搜索。': 'Memories stay on your device. Agent proposals appear in search only after you approve them.',
  '项目索引': 'Project index', '活跃项目条目': 'Active project memories',
  '待审核': 'Pending review', '尚未进入搜索': 'Not yet searchable',
  '记忆关系': 'Memory links', '已建立父子关联': 'Parent and child links',
  '最近更新': 'Recently updated', '快速回到刚刚维护的内容': 'Return to your latest work',
  '查看全部': 'View all', '还没有记忆条目': 'No memories yet',
  '快捷入口': 'Quick actions', '常用的记忆管理操作': 'Common memory tasks',
  '使用 Markdown 记录内容': 'Write content in Markdown',
  '处理审核收件箱': 'Review proposals', '目前没有待审核项': 'Nothing awaiting review',
  '浏览项目索引': 'Browse projects', '查看项目与技术栈记录': 'Explore projects and technology notes',
  '语义搜索记忆库……': 'Search your memories…', '搜索记忆库': 'Search memories',
  '搜索中…': 'Searching…', '搜索': 'Search', '清除': 'Clear',
  '内容类型': 'Content type', '全部类型': 'All types', '状态': 'Status',
  '全部状态': 'All statuses', '标签': 'Tags', '例如：Java, 架构': 'e.g. Java, architecture',
  '记忆条目': 'Memories', '正在更新…': 'Updating…',
  '没有找到匹配内容': 'No matching memories', '记忆列表分页': 'Memory list pages',
  '上一页': 'Previous', '下一页': 'Next',
  '已索引项目': 'Indexed projects', '未标注来源': 'Unknown source',
  '暂无项目索引': 'No indexed projects',
  '创建类型为“项目”的记忆条目后，会集中显示在这里。': 'Create a project memory to see it here.',
  '新建项目条目': 'New project memory',
  '需要人工确认': 'Needs your review',
  '代理提议在批准前保持私有，也不会出现在搜索结果中。': 'Agent proposals stay private and out of search until approved.',
  '来源：': 'Source: ', '批准中…': 'Approving…', '批准入库': 'Approve',
  '审核并编辑': 'Review and edit', '收件箱已清空': 'Inbox is clear',
  '代理提交的新候选记忆会在这里等待你的确认。': 'New agent proposals will appear here for your approval.',
  '编辑条目并指定上级条目，即可调整记忆结构。': 'Set a parent memory while editing to organize your memories.',
  '还没有记忆关系': 'No memory links yet',
  '创建条目后，在编辑页为它选择上级条目。': 'Create a memory, then choose its parent in the editor.',
  '返回': 'Back', '复制 Markdown': 'Copy Markdown', '未标注': 'Unknown',
  '创建于': 'Created', '更新于': 'Updated', '版本': 'Version',
  '标题': 'Title', '输入清晰、可检索的标题': 'Enter a clear, searchable title',
  '类型': 'Type', '来源': 'Source', '逗号分隔，例如：Java, 架构': 'Comma separated, e.g. Java, architecture',
  '内容来源（可选）': 'Content source (optional)', '上级条目': 'Parent memory',
  '无上级（顶层条目）': 'None (top level)', 'Markdown 内容': 'Content',
  '# 标题\n\n在这里输入 Markdown 内容……': '# Title\n\nWrite your Markdown content here…',
  '实时预览': 'Live preview', '纯文本': 'Plain text',
  '输入内容后将在这里实时预览': 'Your content preview will appear here',
  '取消': 'Cancel', '保存中…': 'Saving…', '保存修改': 'Save changes',
  '创建并索引': 'Create and index', '删除这个条目？': 'Delete this memory?',
  '删除中…': 'Deleting…', '确认删除': 'Delete memory',
  '语言': 'Language',
  '记忆管理台': 'MEMORYDOCK CONSOLE', '记忆资料库': 'MEMORY LIBRARY',
  'Markdown 编辑器': 'MARKDOWN EDITOR', '人工审核': 'HUMAN REVIEW',
  '记忆关系图': 'MEMORY MAP', 'Markdown 阅读器': 'MARKDOWN READER',
  '主题': 'Theme', '切换到深色主题': 'Switch to dark theme', '切换到浅色主题': 'Switch to light theme',
  '本地存储信息': 'Local storage', '存储格式': 'Storage format', '纯文本 Markdown (.md)': 'Plain Markdown (.md)',
  '索引引擎': 'Index engine', '运行模式': 'Runtime mode', '本机回环 · 单用户': 'Local loopback · single-user',
  '排序方式': 'Sort by', '创建时间': 'Created', '更新时间': 'Updated',
  '二级标题': 'Heading 2', '加粗': 'Bold', '斜体': 'Italic', '代码': 'Code',
  '引用': 'Quote', '无序列表': 'List', '插入表格': 'Table', '一级标题': 'Heading 1',
  '保存后将写入本地 Markdown 文件并更新搜索索引。': 'Saving writes a local Markdown file and updates the search index.',
  '全部来源': 'All sources', '本地 Markdown 为唯一真实来源;LanceDB 索引可随时重建。': 'Local Markdown files are the single source of truth; the LanceDB index can be rebuilt at any time.',
  '孤立链接': 'Unlinked references', '子条目': 'Child memories', 'YAML Frontmatter': 'YAML frontmatter',
  '无上级条目': 'No parent memory', '已批准': 'Approved', '共': 'Total',
} satisfies Record<string, string>;

export type Phrase = keyof typeof english;

const storageKey = 'memorydock.admin.language';

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

export function translate(language: Language, phrase: Phrase): string {
  return language === 'en' ? english[phrase] : phrase;
}

export function readLanguage(storage: Pick<Storage, 'getItem'> | null = browserStorage()): Language {
  try { return storage?.getItem(storageKey) === 'zh' ? 'zh' : 'en'; }
  catch { return 'en'; }
}

export function saveLanguage(language: Language, storage: Pick<Storage, 'setItem'> | null = browserStorage()): void {
  try { storage?.setItem(storageKey, language); }
  catch { /* The preference remains active for this page when storage is unavailable. */ }
}

export function formatDate(value: string, language: Language): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
