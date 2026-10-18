import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { excerptNoteContent, renderNoteContent } from './markdown';
import type { RenderedNoteContent } from './markdown';
import { MarkdownView } from './markdown-view';
import { formatDate, readLanguage, saveLanguage, translate } from './i18n';
import type { Language, Phrase } from './i18n';
import 'highlight.js/styles/github-dark.css';
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
  if (!response.ok || !body?.status) throw new Error(body?.message || `Request failed (${response.status})`);
  return body.data as T;
}

const parseTags = (value: string) => [...new Set(value.split(',').map(tag => tag.trim()).filter(Boolean))].slice(0, 20);
const excerpt = excerptNoteContent;
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

function TypeBadge({ type, language }: { type: ContentType; language: Language }) {
  const label = CONTENT_TYPES.find(item => item.value === type)?.label as Phrase | undefined;
  return <span className={`type-badge type-${type}`}>{label ? translate(language, label) : type}</span>;
}

function Tags({ tags, language }: { tags: string[]; language: Language }) {
  return tags.length ? <span className="tags">{tags.slice(0, 5).map(tag => <span className="tag" key={tag}>{tag}</span>)}</span> : <span className="muted">{translate(language, '暂无标签')}</span>;
}

function ContentBody({ content, preview = false }: { content: RenderedNoteContent; preview?: boolean }) {
  if (content.format === 'markdown') return <MarkdownView html={content.html} preview={preview} />;
  const className = `markdown-body${preview ? ' preview' : ''} plain-text`;
  return <div className={className}>{content.text}</div>;
}

function App() {
  const [language, setLanguage] = useState<Language>(readLanguage);
  const t = (phrase: Phrase) => translate(language, phrase);
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
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    saveLanguage(language);
  }, [language]);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allApproved = useMemo(() => flattenTree(tree), [tree]);
  const projects = useMemo(() => allApproved.filter(note => note.content_type === 'project' && note.status === 'active'), [allApproved]);
  const recent = useMemo(() => [...allApproved].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 6), [allApproved]);
  const renderedContent = useMemo(() => renderNoteContent(selected?.content || ''), [selected?.content]);
  const previewContent = useMemo(() => renderNoteContent(draft.content), [draft.content]);
  useEffect(() => { document.title = `${selected && view === 'detail' ? selected.title : translate(language, viewTitles[view].title as Phrase)} | MemoryDock`; }, [language, selected, view]);

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
      setSearchResults(await request('/api/search', { method: 'POST', body: JSON.stringify({ query: value, content_type: typeFilter === 'all' ? undefined : typeFilter, status: statusFilter === 'all' ? undefined : statusFilter, tags: parseTags(tagFilter), top_k: 24, sort_by: 'created_at' }) }));
      setError('');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  };
  const saveNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim() || !draft.content.trim()) { setError(t('标题和内容不能为空。')); return; }
    setBusy('save');
    try {
      const payload = { ...draft, title: draft.title.trim(), content: draft.content.trim(), source: draft.source.trim(), tags: draft.tags };
      const wasEditing = Boolean(selected);
      const saved = selected
        ? await request<Note>(`/api/memories/${selected.id}`, { method: 'PUT', body: JSON.stringify({ ...payload, version: selected.version }) })
        : await request<Note>('/api/memories', { method: 'POST', body: JSON.stringify(payload) });
      setSelected(saved);
      setNotice(wasEditing ? t('条目已更新。') : t('条目已创建并建立索引。'));
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
    try { await request<Note>(`/api/memories/${note.id}/approve`, { method: 'POST' }); setNotice(language === 'zh' ? `已批准“${note.title}”。` : `Approved “${note.title}”.`); await refresh(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  };
  const archive = async (note: Note) => {
    setBusy(note.id);
    try {
      const updated = await request<Note>(`/api/memories/${note.id}`, { method: 'PUT', body: JSON.stringify({ status: note.status === 'active' ? 'archived' : 'active' }) });
      if (selected?.id === updated.id) setSelected(updated);
      setNotice(note.status === 'active' ? t('条目已归档。') : t('条目已恢复。'));
      await refresh();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  };
  const remove = async () => {
    if (!deleteTarget) return;
    setBusy('delete');
    try {
      await request<unknown>(`/api/memories/${deleteTarget.id}`, { method: 'DELETE' });
      setNotice(language === 'zh' ? `已删除“${deleteTarget.title}”。` : `Deleted “${deleteTarget.title}”.`);
      const wasSelected = selected?.id === deleteTarget.id;
      setDeleteTarget(null);
      if (wasSelected) { setSelected(null); setView('library'); }
      await refresh();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  };
  const copyMarkdown = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.content); setNotice(t('Markdown 已复制到剪贴板。')); }
    catch { setError(t('复制失败，请检查浏览器的剪贴板权限。')); }
  };

  const visibleNotes = searchResults?.items.map(item => item.entry) || notes;
  const activeMenu = view === 'detail' ? returnView : view;
  const navigation = [
    { label: t('工作台'), items: [{ id: 'dashboard' as View, label: t('首页概览'), icon: 'dashboard' as IconName }] },
    { label: t('记忆库'), items: [
      { id: 'library' as View, label: t('搜索浏览'), icon: 'search' as IconName, count: allApproved.length },
      { id: 'editor' as View, label: t('新建条目'), icon: 'plus' as IconName, action: openCreate },
      { id: 'projects' as View, label: t('项目列表'), icon: 'folder' as IconName, count: projects.length },
      { id: 'inbox' as View, label: t('审核收件箱'), icon: 'inbox' as IconName, count: pending.length },
      { id: 'tree' as View, label: t('记忆地图'), icon: 'tree' as IconName },
    ] },
  ];

  const renderCards = (items: Note[], emptyText = t('暂无记忆条目')) => items.length ? (
    <div className="memory-grid">
      {items.map(note => <article className="memory-card" key={note.id}>
        <div className="memory-card-top"><div><TypeBadge language={language} type={note.content_type} />{note.status === 'archived' && <span className="status-label archived">{t('已归档')}</span>}</div><time dateTime={note.created_at} title={t('创建于')}>{formatDate(note.created_at, language)}</time></div>
        <button className="memory-card-main" onClick={() => openDetail(note)}>
          <strong>{note.title}</strong><span>{excerpt(note.content, 210)}</span>
        </button>
        <div className="memory-card-footer">
          <Tags language={language} tags={note.tags} />
          <div className="memory-card-actions"><button className="icon-button" title={t('编辑')} aria-label={`${t('编辑')} ${note.title}`} onClick={() => openEdit(note)}><Icon name="edit" /></button><button className="icon-button" title={note.status === 'active' ? t('归档') : t('恢复')} aria-label={`${note.status === 'active' ? t('归档') : t('恢复')} ${note.title}`} onClick={() => void archive(note)} disabled={busy === note.id}><Icon name="archive" /></button><button className="icon-button danger" title={t('删除')} aria-label={`${t('删除')} ${note.title}`} onClick={() => setDeleteTarget(note)}><Icon name="trash" /></button></div>
        </div>
      </article>)}
    </div>
  ) : <div className="empty-state"><div className="empty-icon"><Icon name="document" /></div><h3>{emptyText}</h3><p>{t('新建条目，或调整搜索与筛选条件后再试。')}</p><button className="button primary" onClick={openCreate}><Icon name="plus" />{t('新建条目')}</button></div>;

  const renderTree = (items: TreeNote[]): React.ReactNode => <ul className="tree-list">{items.map(note => <li key={note.id}><div className="tree-node"><span className="tree-line" /><button onClick={() => openDetail(note, 'tree')}><Icon name="document" />{note.title}</button><TypeBadge language={language} type={note.content_type} /></div>{note.children.length > 0 && renderTree(note.children)}</li>)}</ul>;

  return <div className="app-shell">
    <button className="mobile-menu" aria-label={t('打开菜单')} onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button>
    {sidebarOpen && <button className="sidebar-scrim" aria-label={t('关闭菜单')} onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark">M</div><div><strong>MemoryDock</strong><span>{t('本地记忆管理台')}</span></div></div>
      <nav aria-label={t('管理菜单')}>{navigation.map(group => <div className="nav-group" key={group.label}><p>{group.label}</p>{group.items.map(item => <button key={item.label} className={`nav-item ${activeMenu === item.id ? 'active' : ''}`} onClick={() => item.action ? item.action() : navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span>{item.count !== undefined && <b>{item.count}</b>}</button>)}</div>)}</nav>
      <div className="sidebar-footer"><span className="local-indicator" /><div><strong>{t('本地私有存储')}</strong><span>{t('数据保存在你的设备上')}</span></div></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div><p className="eyebrow">{viewTitles[view].eyebrow}</p><h1>{view === 'editor' ? (selected ? t('编辑记忆条目') : t('新建记忆条目')) : view === 'detail' && selected ? selected.title : t(viewTitles[view].title as Phrase)}</h1><p className="page-description">{t(viewTitles[view].description as Phrase)}</p></div><div className="topbar-actions"><label className="language-picker"><span>{t('语言')}</span><select aria-label={t('语言')} value={language} onChange={event => setLanguage(event.target.value as Language)}><option value="en">English</option><option value="zh">中文</option></select></label><button className="button secondary" onClick={() => void refresh()} disabled={loading}><Icon name="refresh" />{t('刷新')}</button>{view !== 'editor' && <button className="button primary" onClick={openCreate}><Icon name="plus" />{t('新建条目')}</button>}</div></header>
      {(error || notice) && <div className={`message ${error ? 'error' : 'success'}`} role="status"><span>{error || notice}</span><button aria-label={t('关闭提示')} onClick={() => { setError(''); setNotice(''); }}><Icon name="close" /></button></div>}

      {view === 'dashboard' && <section className="view-section"><div className="stat-grid"><article className="stat-card"><span className="stat-icon green"><Icon name="library" /></span><div><small>{t('记忆总量')}</small><strong>{allApproved.length}</strong><p>{t('已批准并可搜索')}</p></div></article><article className="stat-card"><span className="stat-icon blue"><Icon name="folder" /></span><div><small>{t('项目索引')}</small><strong>{projects.length}</strong><p>{t('活跃项目条目')}</p></div></article><article className="stat-card"><span className="stat-icon amber"><Icon name="inbox" /></span><div><small>{t('待审核')}</small><strong>{pending.length}</strong><p>{t('尚未进入搜索')}</p></div></article><article className="stat-card"><span className="stat-icon violet"><Icon name="tree" /></span><div><small>{t('记忆关系')}</small><strong>{allApproved.filter(note => note.parent_id).length}</strong><p>{t('已建立父子关联')}</p></div></article></div><div className="dashboard-grid"><article className="panel recent-panel"><div className="panel-heading"><div><h2>{t('最近更新')}</h2><p>{t('快速回到刚刚维护的内容')}</p></div><button className="text-button" onClick={() => navigate('library')}>{t('查看全部')} <Icon name="chevron" /></button></div>{recent.length ? <div className="recent-list">{recent.map(note => <button key={note.id} onClick={() => openDetail(note, 'dashboard')}><span className="document-icon"><Icon name="document" /></span><span><strong>{note.title}</strong><small>{formatDate(note.updated_at, language)}</small></span><TypeBadge language={language} type={note.content_type} /><Icon name="chevron" /></button>)}</div> : <div className="compact-empty">{t('还没有记忆条目')}</div>}</article><article className="panel quick-panel"><div className="panel-heading"><div><h2>{t('快捷入口')}</h2><p>{t('常用的记忆管理操作')}</p></div></div><button onClick={openCreate}><span className="quick-icon"><Icon name="plus" /></span><span><strong>{t('新建记忆条目')}</strong><small>{t('使用 Markdown 记录内容')}</small></span></button><button onClick={() => navigate('inbox')}><span className="quick-icon"><Icon name="check" /></span><span><strong>{t('处理审核收件箱')}</strong><small>{pending.length ? language === 'zh' ? `${pending.length} 条等待确认` : `${pending.length} awaiting review` : t('目前没有待审核项')}</small></span></button><button onClick={() => navigate('projects')}><span className="quick-icon"><Icon name="folder" /></span><span><strong>{t('浏览项目索引')}</strong><small>{t('查看项目与技术栈记录')}</small></span></button></article></div></section>}

      {view === 'library' && <section className="view-section"><div className="search-panel"><form className="search-form" onSubmit={submitSearch}><Icon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('语义搜索记忆库……')} aria-label={t('搜索记忆库')} /><button className="button primary" type="submit" disabled={busy === 'search'}>{busy === 'search' ? t('搜索中…') : t('搜索')}</button>{searchResults && <button className="clear-button" type="button" onClick={resetSearch}>{t('清除')}</button>}</form><div className="filters"><label>{t('内容类型')}<select value={typeFilter} onChange={event => { setLoading(true); setPage(1); setTypeFilter(event.target.value as 'all' | ContentType); }}><option value="all">{t('全部类型')}</option>{CONTENT_TYPES.map(type => <option key={type.value} value={type.value}>{t(type.label as Phrase)}</option>)}</select></label><label>{t('状态')}<select value={statusFilter} onChange={event => { setLoading(true); setPage(1); setStatusFilter(event.target.value as 'all' | Status); }}><option value="all">{t('全部状态')}</option><option value="active">{t('使用中')}</option><option value="archived">{t('已归档')}</option></select></label><label className="tag-filter">{t('标签')}<input value={tagFilter} onChange={event => setTagFilter(event.target.value)} onBlur={() => { setLoading(true); setPage(1); setAppliedTagFilter(tagFilter); }} placeholder={t('例如：Java, 架构')} /></label></div></div><div className="section-heading"><div><h2>{searchResults ? language === 'zh' ? `“${query}”的搜索结果` : `Results for “${query}”` : t('记忆条目')}</h2><p>{searchResults ? language === 'zh' ? `${searchResults.items.length} 条相关结果${searchResults.degraded ? ' · 当前使用关键词降级搜索' : ''}` : `${searchResults.items.length} results${searchResults.degraded ? ' · Keyword fallback active' : ''}` : language === 'zh' ? `共 ${total} 条 · 第 ${page}/${totalPages} 页` : `${total} memories · Page ${page} of ${totalPages}`}</p></div>{loading && <span className="loading-label">{t('正在更新…')}</span>}</div>{renderCards(visibleNotes, searchResults ? t('没有找到匹配内容') : t('暂无记忆条目'))}{!searchResults && totalPages > 1 && <nav className="pagination" aria-label={t('记忆列表分页')}><button className="button secondary" disabled={page === 1} onClick={() => { setLoading(true); setPage(current => current - 1); }}>{t('上一页')}</button><span>{language === 'zh' ? `第 ${page} / ${totalPages} 页` : `Page ${page} of ${totalPages}`}</span><button className="button secondary" disabled={page >= totalPages} onClick={() => { setLoading(true); setPage(current => current + 1); }}>{t('下一页')}</button></nav>}</section>}

      {view === 'projects' && <section className="view-section"><div className="section-heading"><div><h2>{t('已索引项目')}</h2><p>{language === 'zh' ? `共 ${projects.length} 个活跃项目` : `${projects.length} active projects`}</p></div></div>{projects.length ? <div className="project-grid">{projects.map(project => <article className="project-card" key={project.id}><div className="project-card-top"><span className="project-icon"><Icon name="folder" /></span><button className="icon-button" aria-label={`${t('编辑')} ${project.title}`} onClick={() => openEdit(project)}><Icon name="edit" /></button></div><button className="project-title" onClick={() => openDetail(project, 'projects')}>{project.title}</button><p>{excerpt(project.content, 210)}</p><Tags language={language} tags={project.tags} /><footer><span>{project.source || t('未标注来源')}</span><time>{formatDate(project.updated_at, language)}</time></footer></article>)}</div> : <div className="empty-state"><div className="empty-icon"><Icon name="folder" /></div><h3>{t('暂无项目索引')}</h3><p>{t('创建类型为“项目”的记忆条目后，会集中显示在这里。')}</p><button className="button primary" onClick={openCreate}><Icon name="plus" />{t('新建项目条目')}</button></div>}</section>}

      {view === 'inbox' && <section className="view-section"><div className="section-heading"><div><h2>{t('需要人工确认')}</h2><p>{t('代理提议在批准前保持私有，也不会出现在搜索结果中。')}</p></div></div>{pending.length ? <div className="inbox-list">{pending.map(note => <article className="proposal" key={note.id}><div className="proposal-content"><div className="proposal-heading"><TypeBadge language={language} type={note.content_type} /><span>{t('来源：')}{note.source || 'agent'}</span></div><h3>{note.title}</h3><p>{note.content}</p><Tags language={language} tags={note.tags} /></div><div className="proposal-actions"><button className="button primary" disabled={busy === note.id} onClick={() => void approve(note)}><Icon name="check" />{busy === note.id ? t('批准中…') : t('批准入库')}</button><button className="button secondary" onClick={() => openEdit(note)}>{t('审核并编辑')}</button><button className="text-danger" onClick={() => setDeleteTarget(note)}>{t('删除')}</button></div></article>)}</div> : <div className="empty-state"><div className="empty-icon"><Icon name="inbox" /></div><h3>{t('收件箱已清空')}</h3><p>{t('代理提交的新候选记忆会在这里等待你的确认。')}</p></div>}</section>}

      {view === 'tree' && <section className="view-section"><div className="section-heading"><div><h2>{t('记忆关系')}</h2><p>{t('编辑条目并指定上级条目，即可调整记忆结构。')}</p></div></div><div className="map-card">{tree.length ? renderTree(tree) : <div className="empty-state compact"><div className="empty-icon"><Icon name="tree" /></div><h3>{t('还没有记忆关系')}</h3><p>{t('创建条目后，在编辑页为它选择上级条目。')}</p></div>}</div></section>}

      {view === 'detail' && selected && <section className="view-section detail-view"><div className="detail-toolbar"><button className="button secondary" onClick={() => navigate(returnView)}><Icon name="back" />{t('返回')}</button><div><button className="button secondary" onClick={() => void copyMarkdown()}><Icon name="copy" />{t('复制 Markdown')}</button><button className="button secondary" onClick={() => openEdit(selected)}><Icon name="edit" />{t('编辑')}</button><button className="button danger-outline" onClick={() => setDeleteTarget(selected)}><Icon name="trash" />{t('删除')}</button></div></div><article className="reader-card"><header className="reader-header"><div className="reader-meta"><TypeBadge language={language} type={selected.content_type} /><span className={`status-label ${selected.status}`}>{selected.status === 'active' ? t('使用中') : t('已归档')}</span><Tags language={language} tags={selected.tags} /></div><h2>{selected.title}</h2><div className="reader-byline"><span>{t('来源：')}{selected.source || t('未标注')}</span><span>{t('创建于')} {formatDate(selected.created_at, language)}</span><span>{t('更新于')} {formatDate(selected.updated_at, language)}</span><span>{t('版本')} {selected.version}</span></div></header><ContentBody content={renderedContent} /></article></section>}

      {view === 'editor' && <section className="view-section"><form className="editor-card" onSubmit={saveNote}><div className="editor-fields"><div className="form-grid"><label className="field full">{t('标题')}<input value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} maxLength={500} autoFocus required placeholder={t('输入清晰、可检索的标题')} /></label><label className="field">{t('类型')}<select value={draft.content_type} onChange={event => setDraft(current => ({ ...current, content_type: event.target.value as ContentType }))}>{CONTENT_TYPES.map(type => <option key={type.value} value={type.value}>{t(type.label as Phrase)}</option>)}</select></label><label className="field">{t('状态')}<select value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value as Status }))}><option value="active">{t('使用中')}</option><option value="archived">{t('已归档')}</option></select></label><label className="field">{t('标签')}<input value={draft.tags.join(', ')} onChange={event => setDraft(current => ({ ...current, tags: parseTags(event.target.value) }))} placeholder={t('逗号分隔，例如：Java, 架构')} /></label><label className="field">{t('来源')}<input value={draft.source} onChange={event => setDraft(current => ({ ...current, source: event.target.value }))} placeholder={t('内容来源（可选）')} /></label>{selected && <label className="field full">{t('上级条目')}<select value={draft.parent_id || ''} onChange={event => setDraft(current => ({ ...current, parent_id: event.target.value || null }))}><option value="">{t('无上级（顶层条目）')}</option>{allApproved.filter(item => item.id !== selected.id).map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>}<label className="field full content-field">{t('Markdown 内容')}<textarea value={draft.content} onChange={event => setDraft(current => ({ ...current, content: event.target.value }))} maxLength={50000} required spellCheck={false} placeholder={t('# 标题\n\n在这里输入 Markdown 内容……')} /></label></div></div><aside className="preview-pane"><div className="preview-heading"><strong>{t('实时预览')}</strong><span>{previewContent.format === 'markdown' ? 'Markdown' : t('纯文本')}</span></div>{draft.content.trim() ? <ContentBody content={previewContent} preview /> : <div className="preview-empty"><Icon name="document" /><p>{t('输入内容后将在这里实时预览')}</p></div>}</aside><footer className="editor-actions"><button className="button secondary" type="button" onClick={() => selected ? navigate('detail') : navigate('library')}>{t('取消')}</button><button className="button primary" type="submit" disabled={busy === 'save'}>{busy === 'save' ? t('保存中…') : selected ? t('保存修改') : t('创建并索引')}</button></footer></form></section>}
    </main>
    {deleteTarget && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDeleteTarget(null)}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={event => event.stopPropagation()}><div className="modal-icon warning"><Icon name="trash" /></div><h2 id="delete-title">{t('删除这个条目？')}</h2><p>{language === 'zh' ? `“${deleteTarget.title}”将从本地 Markdown 文件与搜索索引中移除，此操作无法在管理台中撤销。` : `“${deleteTarget.title}” will be removed from local Markdown files and the search index. You cannot undo this in the console.`}</p><div className="modal-actions"><button className="button secondary" onClick={() => setDeleteTarget(null)}>{t('取消')}</button><button className="button danger-button" onClick={() => void remove()} disabled={busy === 'delete'}>{busy === 'delete' ? t('删除中…') : t('确认删除')}</button></div></section></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
