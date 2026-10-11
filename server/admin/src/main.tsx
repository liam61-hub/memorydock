import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderMarkdown } from './markdown';
import './style.css';

type ContentType = 'project' | 'note' | 'article' | 'doc' | 'personal_info';
type Status = 'active' | 'archived';
type View = 'dashboard' | 'library' | 'editor' | 'projects' | 'inbox' | 'tree' | 'detail';
type IconName = 'dashboard' | 'library' | 'inbox' | 'tree' | 'search' | 'plus' | 'refresh' | 'edit' | 'archive' | 'trash' | 'check' | 'close' | 'folder' | 'document' | 'back' | 'copy' | 'menu' | 'chevron';
type Note = { id: string; title: string; content: string; content_type: ContentType; tags: string[]; source: string; status: Status; review_status: 'pending' | 'approved'; updated_at: string; created_at: string; version: number; parent_id: string | null };
type TreeNote = Note & { children: TreeNote[] };
type SearchResult = { entry: Note; score: number; matched_chunks?: { content_preview: string }[] };
type Draft = Pick<Note, 'title' | 'content' | 'content_type' | 'tags' | 'source' | 'status' | 'parent_id'>;
type WorkspaceData = { library: { items: Note[]; total: number }; inbox: { items: Note[]; total: number }; map: { items: TreeNote[] } };

const CONTENT_TYPES: Array<{ value: ContentType; label: string }> = [
  { value: 'note', label: '笔记' },
  { value: 'doc', label: '文档' },
  { value: 'article', label: '文章' },
  { value: 'project', label: '项目' },
  { value: 'personal_info', label: '个人资料' },
];
const newDraft = (): Draft => ({ title: '', content: '', content_type: 'note', tags: [], source: 'local console', status: 'active', parent_id: null });
const viewTitles: Record<View, { eyebrow: string; title: string; description: string }> = {
  dashboard: { eyebrow: 'MEMORYDOCK CONSOLE', title: '首页概览', description: '本地记忆库的运行概况与最近更新' },
  library: { eyebrow: 'MEMORY LIBRARY', title: '搜索浏览', description: '搜索、筛选和管理已入库的记忆' },
  editor: { eyebrow: 'MARKDOWN EDITOR', title: '新建记忆条目', description: '用 Markdown 沉淀可搜索的长期记忆' },
  projects: { eyebrow: 'PROJECT INDEX', title: '项目列表', description: '集中浏览已索引的项目记忆' },
  inbox: { eyebrow: 'HUMAN REVIEW', title: '审核收件箱', description: '确认代理提交的候选记忆后再进入搜索' },
  tree: { eyebrow: 'MEMORY MAP', title: '记忆地图', description: '按父子关系查看记忆结构' },
  detail: { eyebrow: 'MARKDOWN READER', title: '条目详情', description: '专注阅读已沉淀的 Markdown 内容' },
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) } });
  const body = await response.json().catch(() => null) as { status?: boolean; data?: T; message?: string } | null;
  if (!response.ok || !body?.status) throw new Error(body?.message || `请求失败（${response.status}）`);
  return body.data as T;
}

const parseTags = (value: string) => [...new Set(value.split(',').map(tag => tag.trim()).filter(Boolean))].slice(0, 20);
const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const excerpt = (value: string, limit = 150) => value.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value;
const flattenTree = (items: TreeNote[]): TreeNote[] => items.flatMap(item => [item, ...flattenTree(item.children)]);

async function loadWorkspace(page: number, pageSize: number, typeFilter: 'all' | ContentType, statusFilter: 'all' | Status, tagFilter: string): Promise<WorkspaceData> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), review_status: 'approved' });
  if (typeFilter !== 'all') params.set('content_type', typeFilter);
  if (statusFilter !== 'all') params.set('status', statusFilter);
  if (tagFilter.trim()) params.set('tags', parseTags(tagFilter).join(','));
  const [library, inbox, map] = await Promise.all([
    request<{ items: Note[]; total: number }>(`/api/memories?${params}`),
    request<{ items: Note[]; total: number }>('/api/memories?review_status=pending&page_size=100'),
    request<{ items: TreeNote[] }>('/api/memories/tree'),
  ]);
  return { library, inbox, map };
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    library: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8M8 11h7" /></>,
    inbox: <><path d="M4 4h16v14H4z" /><path d="M4 13h5l2 3h2l2-3h5" /></>,
    tree: <><path d="M5 4v16M5 8h5v4h9M5 16h5v-4" /><circle cx="19" cy="12" r="2" /><circle cx="10" cy="8" r="2" /><circle cx="10" cy="16" r="2" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: <><path d="M20 11a8 8 0 1 0 2 5" /><path d="M20 4v7h-7" /></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13 7 4 4" /></>,
    archive: <><path d="M4 7h16v13H4zM3 4h18v3H3zM9 12h6" /></>,
    trash: <><path d="M4 7h16M9 11v5M15 11v5M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    folder: <><path d="M3 6h7l2 2h9v11H3z" /><path d="M3 6v13" /></>,
    document: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    copy: <><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    chevron: <path d="m9 18 6-6-6-6" />,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function TypeBadge({ type }: { type: ContentType }) {
  return <span className={`type-badge type-${type}`}>{CONTENT_TYPES.find(item => item.value === type)?.label || type}</span>;
}

function Tags({ tags }: { tags: string[] }) {
  return tags.length ? <span className="tags">{tags.slice(0, 5).map(tag => <span className="tag" key={tag}>{tag}</span>)}</span> : <span className="muted">暂无标签</span>;
}

function App() {
  const [view, setView] = useState<View>('dashboard');
  const [returnView, setReturnView] = useState<View>('library');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [pending, setPending] = useState<Note[]>([]);
  const [tree, setTree] = useState<TreeNote[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<'all' | ContentType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('active');
  const [tagFilter, setTagFilter] = useState('');
  const [appliedTagFilter, setAppliedTagFilter] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ items: SearchResult[]; degraded: boolean; suggestion?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [selected, setSelected] = useState<Note | null>(null);
  const [draft, setDraft] = useState<Draft>(newDraft());
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allApproved = useMemo(() => flattenTree(tree), [tree]);
  const projects = useMemo(() => allApproved.filter(note => note.content_type === 'project' && note.status === 'active'), [allApproved]);
  const recent = useMemo(() => [...allApproved].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 6), [allApproved]);
  const renderedContent = useMemo(() => renderMarkdown(selected?.content || ''), [selected?.content]);
  const previewContent = useMemo(() => renderMarkdown(draft.content), [draft.content]);

  const applyWorkspace = (workspace: WorkspaceData) => {
    setNotes(workspace.library.items);
    setTotal(workspace.library.total);
    setPending(workspace.inbox.items);
    setTree(workspace.map.items);
    setError('');
  };
  const refresh = async () => {
    setLoading(true);
    try { applyWorkspace(await loadWorkspace(page, pageSize, typeFilter, statusFilter, appliedTagFilter)); }
    catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let cancelled = false;
    void loadWorkspace(page, pageSize, typeFilter, statusFilter, appliedTagFilter)
      .then(workspace => { if (!cancelled) applyWorkspace(workspace); })
      .catch(reason => { if (!cancelled) setError((reason as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [appliedTagFilter, page, statusFilter, typeFilter]);

  const navigate = (next: View) => {
    setView(next);
    setSidebarOpen(false);
    if (next !== 'library') setSearchResults(null);
  };
  const openCreate = () => { setSelected(null); setDraft(newDraft()); navigate('editor'); };
  const openDetail = (note: Note, from: View = view) => {
    setSelected(note);
    setReturnView(from === 'detail' || from === 'editor' ? 'library' : from);
    navigate('detail');
  };
  const openEdit = (note: Note) => {
    if (view !== 'detail' && view !== 'editor') setReturnView(view);
    setSelected(note);
    setDraft({ title: note.title, content: note.content, content_type: note.content_type, tags: note.tags, source: note.source, status: note.status, parent_id: note.parent_id });
    navigate('editor');
  };
  const resetSearch = () => { setQuery(''); setSearchResults(null); };
  const submitSearch = async (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) { resetSearch(); return; }
    setBusy('search');
    try {
      setSearchResults(await request('/api/search', { method: 'POST', body: JSON.stringify({ query: value, content_type: typeFilter === 'all' ? undefined : typeFilter, status: statusFilter === 'all' ? undefined : statusFilter, tags: parseTags(tagFilter), top_k: 24 }) }));
      setError('');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  };
  const saveNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim() || !draft.content.trim()) { setError('标题和内容不能为空。'); return; }
    setBusy('save');
    try {
      const payload = { ...draft, title: draft.title.trim(), content: draft.content.trim(), source: draft.source.trim(), tags: draft.tags };
      const wasEditing = Boolean(selected);
      const saved = selected
        ? await request<Note>(`/api/memories/${selected.id}`, { method: 'PUT', body: JSON.stringify({ ...payload, version: selected.version }) })
        : await request<Note>('/api/memories', { method: 'POST', body: JSON.stringify(payload) });
      setSelected(saved);
      setNotice(wasEditing ? '条目已更新。' : '条目已创建并建立索引。');
      setError('');
      resetSearch();
      if (!wasEditing) setReturnView('library');
      setView('detail');
      await refresh();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  };
  const approve = async (note: Note) => {
    setBusy(note.id);
    try { await request<Note>(`/api/memories/${note.id}/approve`, { method: 'POST' }); setNotice(`已批准“${note.title}”。`); await refresh(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  };
  const archive = async (note: Note) => {
    setBusy(note.id);
    try {
      const updated = await request<Note>(`/api/memories/${note.id}`, { method: 'PUT', body: JSON.stringify({ status: note.status === 'active' ? 'archived' : 'active' }) });
      if (selected?.id === updated.id) setSelected(updated);
      setNotice(note.status === 'active' ? '条目已归档。' : '条目已恢复。');
      await refresh();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  };
  const remove = async () => {
    if (!deleteTarget) return;
    setBusy('delete');
    try {
      await request<unknown>(`/api/memories/${deleteTarget.id}`, { method: 'DELETE' });
      setNotice(`已删除“${deleteTarget.title}”。`);
      const wasSelected = selected?.id === deleteTarget.id;
      setDeleteTarget(null);
      if (wasSelected) { setSelected(null); setView('library'); }
      await refresh();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  };
  const copyMarkdown = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.content); setNotice('Markdown 已复制到剪贴板。'); }
    catch { setError('复制失败，请检查浏览器的剪贴板权限。'); }
  };

  const visibleNotes = searchResults?.items.map(item => item.entry) || notes;
  const activeMenu = view === 'detail' ? returnView : view;
  const navigation = [
    { label: '工作台', items: [{ id: 'dashboard' as View, label: '首页概览', icon: 'dashboard' as IconName }] },
    { label: '记忆库', items: [
      { id: 'library' as View, label: '搜索浏览', icon: 'search' as IconName, count: allApproved.length },
      { id: 'editor' as View, label: '新建条目', icon: 'plus' as IconName, action: openCreate },
      { id: 'projects' as View, label: '项目列表', icon: 'folder' as IconName, count: projects.length },
      { id: 'inbox' as View, label: '审核收件箱', icon: 'inbox' as IconName, count: pending.length },
      { id: 'tree' as View, label: '记忆地图', icon: 'tree' as IconName },
    ] },
  ];

  const renderTable = (items: Note[], emptyText = '暂无记忆条目') => items.length ? (
    <div className="memory-table">
      <div className="table-head"><span>标题</span><span>类型</span><span>标签</span><span>更新时间</span><span>操作</span></div>
      {items.map(note => <div className="table-row" key={note.id}>
        <button className="title-cell" onClick={() => openDetail(note)}><strong>{note.title}</strong><span>{excerpt(note.content)}</span></button>
        <div><TypeBadge type={note.content_type} /></div>
        <div><Tags tags={note.tags} /></div>
        <time>{formatDate(note.updated_at)}</time>
        <div className="row-actions"><button className="icon-button" title="编辑" aria-label={`编辑 ${note.title}`} onClick={() => openEdit(note)}><Icon name="edit" /></button><button className="icon-button" title={note.status === 'active' ? '归档' : '恢复'} aria-label={`${note.status === 'active' ? '归档' : '恢复'} ${note.title}`} onClick={() => void archive(note)} disabled={busy === note.id}><Icon name="archive" /></button><button className="icon-button danger" title="删除" aria-label={`删除 ${note.title}`} onClick={() => setDeleteTarget(note)}><Icon name="trash" /></button></div>
      </div>)}
    </div>
  ) : <div className="empty-state"><div className="empty-icon"><Icon name="document" /></div><h3>{emptyText}</h3><p>新建条目，或调整搜索与筛选条件后再试。</p><button className="button primary" onClick={openCreate}><Icon name="plus" />新建条目</button></div>;

  const renderTree = (items: TreeNote[]): React.ReactNode => <ul className="tree-list">{items.map(note => <li key={note.id}><div className="tree-node"><span className="tree-line" /><button onClick={() => openDetail(note, 'tree')}><Icon name="document" />{note.title}</button><TypeBadge type={note.content_type} /></div>{note.children.length > 0 && renderTree(note.children)}</li>)}</ul>;

  return <div className="app-shell">
    <button className="mobile-menu" aria-label="打开菜单" onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="关闭菜单" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark">M</div><div><strong>MemoryDock</strong><span>本地记忆管理台</span></div></div>
      <nav aria-label="管理菜单">{navigation.map(group => <div className="nav-group" key={group.label}><p>{group.label}</p>{group.items.map(item => <button key={item.label} className={`nav-item ${activeMenu === item.id ? 'active' : ''}`} onClick={() => item.action ? item.action() : navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span>{item.count !== undefined && <b>{item.count}</b>}</button>)}</div>)}</nav>
      <div className="sidebar-footer"><span className="local-indicator" /><div><strong>本地私有存储</strong><span>数据保存在你的设备上</span></div></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div><p className="eyebrow">{viewTitles[view].eyebrow}</p><h1>{view === 'editor' ? (selected ? '编辑记忆条目' : '新建记忆条目') : view === 'detail' && selected ? selected.title : viewTitles[view].title}</h1><p className="page-description">{viewTitles[view].description}</p></div><div className="topbar-actions"><button className="button secondary" onClick={() => void refresh()} disabled={loading}><Icon name="refresh" />刷新</button>{view !== 'editor' && <button className="button primary" onClick={openCreate}><Icon name="plus" />新建条目</button>}</div></header>
      {(error || notice) && <div className={`message ${error ? 'error' : 'success'}`} role="status"><span>{error || notice}</span><button aria-label="关闭提示" onClick={() => { setError(''); setNotice(''); }}><Icon name="close" /></button></div>}

      {view === 'dashboard' && <section className="view-section"><div className="stat-grid"><article className="stat-card"><span className="stat-icon green"><Icon name="library" /></span><div><small>记忆总量</small><strong>{allApproved.length}</strong><p>已批准并可搜索</p></div></article><article className="stat-card"><span className="stat-icon blue"><Icon name="folder" /></span><div><small>项目索引</small><strong>{projects.length}</strong><p>活跃项目条目</p></div></article><article className="stat-card"><span className="stat-icon amber"><Icon name="inbox" /></span><div><small>待审核</small><strong>{pending.length}</strong><p>尚未进入搜索</p></div></article><article className="stat-card"><span className="stat-icon violet"><Icon name="tree" /></span><div><small>记忆关系</small><strong>{allApproved.filter(note => note.parent_id).length}</strong><p>已建立父子关联</p></div></article></div><div className="dashboard-grid"><article className="panel recent-panel"><div className="panel-heading"><div><h2>最近更新</h2><p>快速回到刚刚维护的内容</p></div><button className="text-button" onClick={() => navigate('library')}>查看全部 <Icon name="chevron" /></button></div>{recent.length ? <div className="recent-list">{recent.map(note => <button key={note.id} onClick={() => openDetail(note, 'dashboard')}><span className="document-icon"><Icon name="document" /></span><span><strong>{note.title}</strong><small>{formatDate(note.updated_at)}</small></span><TypeBadge type={note.content_type} /><Icon name="chevron" /></button>)}</div> : <div className="compact-empty">还没有记忆条目</div>}</article><article className="panel quick-panel"><div className="panel-heading"><div><h2>快捷入口</h2><p>常用的记忆管理操作</p></div></div><button onClick={openCreate}><span className="quick-icon"><Icon name="plus" /></span><span><strong>新建记忆条目</strong><small>使用 Markdown 记录内容</small></span></button><button onClick={() => navigate('inbox')}><span className="quick-icon"><Icon name="check" /></span><span><strong>处理审核收件箱</strong><small>{pending.length ? `${pending.length} 条等待确认` : '目前没有待审核项'}</small></span></button><button onClick={() => navigate('projects')}><span className="quick-icon"><Icon name="folder" /></span><span><strong>浏览项目索引</strong><small>查看项目与技术栈记录</small></span></button></article></div></section>}

      {view === 'library' && <section className="view-section"><div className="search-panel"><form className="search-form" onSubmit={submitSearch}><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="语义搜索记忆库……" aria-label="搜索记忆库" /><button className="button primary" type="submit" disabled={busy === 'search'}>{busy === 'search' ? '搜索中…' : '搜索'}</button>{searchResults && <button className="clear-button" type="button" onClick={resetSearch}>清除</button>}</form><div className="filters"><label>内容类型<select value={typeFilter} onChange={event => { setLoading(true); setPage(1); setTypeFilter(event.target.value as 'all' | ContentType); }}><option value="all">全部类型</option>{CONTENT_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label>状态<select value={statusFilter} onChange={event => { setLoading(true); setPage(1); setStatusFilter(event.target.value as 'all' | Status); }}><option value="all">全部状态</option><option value="active">使用中</option><option value="archived">已归档</option></select></label><label className="tag-filter">标签<input value={tagFilter} onChange={event => setTagFilter(event.target.value)} onBlur={() => { setLoading(true); setPage(1); setAppliedTagFilter(tagFilter); }} placeholder="例如：Java, 架构" /></label></div></div><div className="section-heading"><div><h2>{searchResults ? `“${query}”的搜索结果` : '记忆条目'}</h2><p>{searchResults ? `${searchResults.items.length} 条相关结果${searchResults.degraded ? ' · 当前使用关键词降级搜索' : ''}` : `共 ${total} 条 · 第 ${page}/${totalPages} 页`}</p></div>{loading && <span className="loading-label">正在更新…</span>}</div>{renderTable(visibleNotes, searchResults ? '没有找到匹配内容' : '暂无记忆条目')}{!searchResults && totalPages > 1 && <nav className="pagination" aria-label="记忆列表分页"><button className="button secondary" disabled={page === 1} onClick={() => { setLoading(true); setPage(current => current - 1); }}>上一页</button><span>第 {page} / {totalPages} 页</span><button className="button secondary" disabled={page >= totalPages} onClick={() => { setLoading(true); setPage(current => current + 1); }}>下一页</button></nav>}</section>}

      {view === 'projects' && <section className="view-section"><div className="section-heading"><div><h2>已索引项目</h2><p>共 {projects.length} 个活跃项目</p></div></div>{projects.length ? <div className="project-grid">{projects.map(project => <article className="project-card" key={project.id}><div className="project-card-top"><span className="project-icon"><Icon name="folder" /></span><button className="icon-button" aria-label={`编辑 ${project.title}`} onClick={() => openEdit(project)}><Icon name="edit" /></button></div><button className="project-title" onClick={() => openDetail(project, 'projects')}>{project.title}</button><p>{excerpt(project.content, 210)}</p><Tags tags={project.tags} /><footer><span>{project.source || '未标注来源'}</span><time>{formatDate(project.updated_at)}</time></footer></article>)}</div> : <div className="empty-state"><div className="empty-icon"><Icon name="folder" /></div><h3>暂无项目索引</h3><p>创建类型为“项目”的记忆条目后，会集中显示在这里。</p><button className="button primary" onClick={openCreate}><Icon name="plus" />新建项目条目</button></div>}</section>}

      {view === 'inbox' && <section className="view-section"><div className="section-heading"><div><h2>需要人工确认</h2><p>代理提议在批准前保持私有，也不会出现在搜索结果中。</p></div></div>{pending.length ? <div className="inbox-list">{pending.map(note => <article className="proposal" key={note.id}><div className="proposal-content"><div className="proposal-heading"><TypeBadge type={note.content_type} /><span>来源：{note.source || 'agent'}</span></div><h3>{note.title}</h3><p>{note.content}</p><Tags tags={note.tags} /></div><div className="proposal-actions"><button className="button primary" disabled={busy === note.id} onClick={() => void approve(note)}><Icon name="check" />{busy === note.id ? '批准中…' : '批准入库'}</button><button className="button secondary" onClick={() => openEdit(note)}>审核并编辑</button><button className="text-danger" onClick={() => setDeleteTarget(note)}>删除</button></div></article>)}</div> : <div className="empty-state"><div className="empty-icon"><Icon name="inbox" /></div><h3>收件箱已清空</h3><p>代理提交的新候选记忆会在这里等待你的确认。</p></div>}</section>}

      {view === 'tree' && <section className="view-section"><div className="section-heading"><div><h2>记忆关系</h2><p>编辑条目并指定上级条目，即可调整记忆结构。</p></div></div><div className="map-card">{tree.length ? renderTree(tree) : <div className="empty-state compact"><div className="empty-icon"><Icon name="tree" /></div><h3>还没有记忆关系</h3><p>创建条目后，在编辑页为它选择上级条目。</p></div>}</div></section>}

      {view === 'detail' && selected && <section className="view-section detail-view"><div className="detail-toolbar"><button className="button secondary" onClick={() => navigate(returnView)}><Icon name="back" />返回</button><div><button className="button secondary" onClick={() => void copyMarkdown()}><Icon name="copy" />复制 Markdown</button><button className="button secondary" onClick={() => openEdit(selected)}><Icon name="edit" />编辑</button><button className="button danger-outline" onClick={() => setDeleteTarget(selected)}><Icon name="trash" />删除</button></div></div><article className="reader-card"><header className="reader-header"><div className="reader-meta"><TypeBadge type={selected.content_type} /><span className={`status-label ${selected.status}`}>{selected.status === 'active' ? '使用中' : '已归档'}</span><Tags tags={selected.tags} /></div><h2>{selected.title}</h2><div className="reader-byline"><span>来源：{selected.source || '未标注'}</span><span>创建于 {formatDate(selected.created_at)}</span><span>更新于 {formatDate(selected.updated_at)}</span><span>版本 {selected.version}</span></div></header><div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderedContent }} /></article></section>}

      {view === 'editor' && <section className="view-section"><form className="editor-card" onSubmit={saveNote}><div className="editor-fields"><div className="form-grid"><label className="field full">标题<input value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} maxLength={500} autoFocus required placeholder="输入清晰、可检索的标题" /></label><label className="field">类型<select value={draft.content_type} onChange={event => setDraft(current => ({ ...current, content_type: event.target.value as ContentType }))}>{CONTENT_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label className="field">状态<select value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value as Status }))}><option value="active">使用中</option><option value="archived">已归档</option></select></label><label className="field">标签<input value={draft.tags.join(', ')} onChange={event => setDraft(current => ({ ...current, tags: parseTags(event.target.value) }))} placeholder="逗号分隔，例如：Java, 架构" /></label><label className="field">来源<input value={draft.source} onChange={event => setDraft(current => ({ ...current, source: event.target.value }))} placeholder="内容来源（可选）" /></label>{selected && <label className="field full">上级条目<select value={draft.parent_id || ''} onChange={event => setDraft(current => ({ ...current, parent_id: event.target.value || null }))}><option value="">无上级（顶层条目）</option>{allApproved.filter(item => item.id !== selected.id).map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>}<label className="field full content-field">Markdown 内容<textarea value={draft.content} onChange={event => setDraft(current => ({ ...current, content: event.target.value }))} maxLength={50000} required spellCheck={false} placeholder={'# 标题\n\n在这里输入 Markdown 内容……'} /></label></div></div><aside className="preview-pane"><div className="preview-heading"><strong>实时预览</strong><span>Markdown</span></div>{draft.content.trim() ? <div className="markdown-body preview" dangerouslySetInnerHTML={{ __html: previewContent }} /> : <div className="preview-empty"><Icon name="document" /><p>输入内容后将在这里实时预览</p></div>}</aside><footer className="editor-actions"><button className="button secondary" type="button" onClick={() => selected ? navigate('detail') : navigate('library')}>取消</button><button className="button primary" type="submit" disabled={busy === 'save'}>{busy === 'save' ? '保存中…' : selected ? '保存修改' : '创建并索引'}</button></footer></form></section>}
    </main>
    {deleteTarget && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDeleteTarget(null)}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={event => event.stopPropagation()}><div className="modal-icon warning"><Icon name="trash" /></div><h2 id="delete-title">删除这个条目？</h2><p>“{deleteTarget.title}”将从本地 Markdown 文件与搜索索引中移除，此操作无法在管理台中撤销。</p><div className="modal-actions"><button className="button secondary" onClick={() => setDeleteTarget(null)}>取消</button><button className="button danger-button" onClick={() => void remove()} disabled={busy === 'delete'}>{busy === 'delete' ? '删除中…' : '确认删除'}</button></div></section></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
