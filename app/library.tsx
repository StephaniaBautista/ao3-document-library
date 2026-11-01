'use client';

import TranslationPanel from './translation-panel';
import DeleteAccount from './delete-account';
import DriveImport from './drive-import';
import NotificationIssues from './notification-issues';
import { extractMetadata, extractPdfMetadataFromUrl } from '@/lib/catalog/extract-metadata';
import { uploadLargeStory } from '@/lib/catalog/upload';
import { splitTranslationText } from '@/lib/catalog/extract-text';
import { sanitizeEpubDocument } from '@/lib/catalog/sanitize-epub';
import { protectReaderDocument } from '@/lib/catalog/reader-copy-protection.mjs';
import { createDeferredProgressWriter, trackClosingProgress, waitForClosingProgress } from '@/lib/catalog/deferred-progress.mjs';
import { authClient } from '@/lib/auth-client';
import { useModalAccessibility } from '@/lib/use-modal-accessibility';
import { setSharedAppearance, useLibraryPreferences, type Appearance } from '@/lib/library-preferences';
import type { TranslationWindow } from '@/lib/catalog/translation-window';
import { queueTranslationProgress } from '@/lib/catalog/translation-progress.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, ChevronDown, ChevronLeft, ChevronRight,
  CloudUpload, FileText, Folder, FolderPlus, HardDrive,
  Heart, LayoutGrid, List, LoaderCircle, LogOut, Pencil, Moon, PanelLeftClose, PanelLeftOpen, Search, SlidersHorizontal, Sun, Trash2,
  Upload, X,
} from 'lucide-react';

type FolderItem = { id: string; parentId: string | null; name: string; createdAt: number };
export type FileItem = { id: string; folderId: string | null; name: string; title: string; type: 'pdf' | 'epub'; size: number; createdAt: number; author?: string | null; summary?: string | null; fandom?: string | null; relationship?: string | null; tags?: string | null; warnings?: string | null; language?: string | null; rating?: string | null; category?: string | null; characters?: string | null; wordCount?: number | null; chapterCount?: number | null; totalChapters?: number | null; ao3Url?: string | null };
type LibraryData = { folders: FolderItem[]; files: FileItem[]; hasMore: boolean };
type Account = { id: string; name: string; email: string; role: 'admin' | 'moderator' | 'user' };

const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fileDate = (date: number) => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);

export default function Library({ user }: { user: Account }) {
  useModalAccessibility();
  const [data, setData] = useState<LibraryData>({ folders: [], files: [], hasMore: false });
  const [metadataVersion, setMetadataVersion] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState('title');
  const [filters, setFilters] = useState({ fandom: '', relationship: '', include: '', exclude: '', rating: '', category: '', characters: '', language: '', status: '', minWords: '', maxWords: '', minChapters: '', maxChapters: '' });
  const { preferences, updatePreferences } = useLibraryPreferences(user.id);
  const { view } = preferences;
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState('');
  const [reader, setReader] = useState<FileItem | null>(null);
  const [details, setDetails] = useState<FileItem | null>(null);
  const [moving, setMoving] = useState<FileItem | null>(null);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [removalStory, setRemovalStory] = useState<FileItem | null>(null);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [continueOpen, setContinueOpen] = useState(false);
  const [reminderStory, setReminderStory] = useState<FileItem | null>(null);
  const [editingStory, setEditingStory] = useState<FileItem | null>(null);
  const [usersOpen, setUsersOpen] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const [notificationIssuesOpen, setNotificationIssuesOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [favoriteStory, setFavoriteStory] = useState<FileItem | null>(null);
  const [destination, setDestination] = useState('');
  const [newFolder, setNewFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState<FolderItem | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderError, setFolderError] = useState('');
  const [drag, setDrag] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const customizeRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileSidebarTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!customizeOpen) return;
    const dismiss = (event: PointerEvent) => { if (!customizeRef.current?.contains(event.target as Node)) setCustomizeOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setCustomizeOpen(false); customizeRef.current?.querySelector('button')?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [customizeOpen]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    sidebarRef.current?.querySelector<HTMLButtonElement>('.mobile-sidebar-close')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileSidebarOpen(false);
        mobileSidebarTrigger.current?.focus();
      } else if (event.key === 'Tab' && sidebarRef.current) {
        const controls = Array.from(sidebarRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')).filter(control => control.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const desktop = window.matchMedia('(min-width: 701px)');
    const onResize = (event: MediaQueryListEvent) => { if (event.matches) setMobileSidebarOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    desktop.addEventListener('change', onResize);
    return () => { document.removeEventListener('keydown', onKeyDown); desktop.removeEventListener('change', onResize); };
  }, [mobileSidebarOpen]);

  useEffect(() => {
    if (user.role !== 'admin') return;
    let cancelled = false;
    let timer: number | undefined;
    const process = async () => {
      try {
        const res = await fetch('/api/admin/metadata');
        if (!res.ok) return;
        const data = await res.json() as { stories: { id: string; filename: string; fileType: 'pdf' | 'epub'; size: number }[]; serverExtraction?: boolean };
        let updated = false;
        for (const story of data.stories) {
          if (cancelled) break;
          try {
            const url = `/api/catalog/stories/${encodeURIComponent(story.id)}/file`;
            let metadata;
            if (story.fileType === 'pdf' && story.size > 24 * 1024 * 1024) metadata = await extractPdfMetadataFromUrl(url);
            else {
              const fileRes = await fetch(url);
              if (!fileRes.ok) throw new Error('File unavailable');
              metadata = await extractMetadata(await fileRes.blob(), story.fileType);
            }
            const saved = await fetch('/api/admin/metadata', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: story.id, metadata }) });
            if (saved.ok) updated = true;
          } catch {
            if (!data.serverExtraction) await fetch('/api/admin/metadata', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: story.id, failed: true }) });
          }
        }
        if (updated && !cancelled) setMetadataVersion(value => value + 1);
      } catch { /* Retry when the administrator reconnects. */ } finally { if (!cancelled) timer = window.setTimeout(() => void process(), 10000); }
    };
    void process();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [user.role]);

  async function signOut() {
    const result = await authClient.signOut();
    if (result.error) { setMessage('Could not sign out. Please try again.'); return; }
    setSharedAppearance(preferences.appearance, preferences.lightAppearance);
    window.location.reload();
  }

  const load = useCallback(async (append = false) => {
    const seq = ++request.current;
    if (!append) setLoading(true);
    const params = new URLSearchParams();
    if (current) params.set('folder', current);
    params.set('sort', sort);
    if (query.trim()) params.set('q', query.trim());
    for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim());
    if (append) params.set('offset', String(data.files.length));
    try {
      const [folderRes, storyRes] = await Promise.all([fetch('/api/catalog/folders'), fetch(`/api/catalog/stories?${params}`)]);
      const folderData = await folderRes.json() as { folders?: FolderItem[]; error?: string };
      const storyData = await storyRes.json() as { stories?: ({ id: string; folderId: string | null; filename: string; fileType: 'pdf' | 'epub'; size: number; createdAt: number } & Pick<FileItem, 'title' | 'author' | 'summary' | 'fandom' | 'relationship' | 'tags' | 'warnings' | 'language' | 'rating' | 'category' | 'characters' | 'wordCount' | 'chapterCount' | 'totalChapters' | 'ao3Url'>)[]; hasMore?: boolean; error?: string };
      if (!folderRes.ok || !storyRes.ok) throw Error(folderData.error || storyData.error || 'Could not load the catalog.');
      const json: LibraryData = { folders: folderData.folders || [], files: (storyData.stories || []).map(story => ({ ...story, name: story.filename, type: story.fileType })), hasMore: !!storyData.hasMore };
      if (seq === request.current) setData(old => append ? { ...json, files: [...old.files, ...json.files] } : json);
    } catch (error) {
      if (seq === request.current) setMessage(error instanceof Error ? error.message : 'Could not load your library.');
    } finally {
      if (seq === request.current) setLoading(false);
    }
  }, [current, query, filters, sort, data.files.length]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 200);
    return () => clearTimeout(timer);
  }, [current, query, filters, sort, metadataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFolder = (id: string | null) => { setCurrent(id); setQuery(''); setMobileSidebarOpen(false); if (mobileSidebarOpen) mobileSidebarTrigger.current?.focus(); };
  const openNewFolder = () => { setFolderName(''); setFolderError(''); setNewFolder(true); };
  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length || uploading) return;
    let success = 0, duplicates = 0;
    const failed: string[] = [];
    for (let index = 0; index < list.length; index++) {
      const file = list[index];
      setUploading(`Uploading ${index + 1} of ${list.length}: ${file.name}`);
      try {
        if (file.size > 50 * 1024 * 1024) {
          const result = await uploadLargeStory(file, current, (part, count) => setUploading(`Uploading ${file.name}: part ${part} of ${count}`));
          if (result.duplicate) duplicates++; else success++;
          continue;
        }
        const form = new FormData();
        form.append('file', file);
        try {
          const metadata = await extractMetadata(file, file.name.toLowerCase().endsWith('.epub') ? 'epub' : 'pdf');
          for (const [key, value] of Object.entries(metadata)) if (value !== undefined && value !== null) form.append(key, String(value));
        } catch { /* The original can still be added when metadata is unavailable. */ }
        if (current) form.append('folderId', current);
        const res = await fetch('/api/catalog/stories', { method: 'POST', body: form });
        const json = await res.json() as { error?: string; duplicate?: boolean };
        if (!res.ok) throw Error(json.error);
        if (json.duplicate) duplicates++; else success++;
      } catch (error) {
        failed.push(`${file.name}: ${error instanceof Error ? error.message : 'Upload failed'}`);
      }
    }
    setUploading('');
    setMessage(`${success} file(s) added. ${duplicates ? `${duplicates} already existed. ` : ''}${failed.length ? failed.join(' · ') : ''}`);
    await load();
    if (input.current) input.current.value = '';
  };
  const createFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const res = await fetch('/api/catalog/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: folderName, parentId: current }) });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw Error(json.error);
      setNewFolder(false); setFolderName(''); await load();
    } catch (error) { setFolderError(error instanceof Error ? error.message : 'Could not create the folder.'); }
  };
  const remove = async (id: string, kind: 'file' | 'folder', name: string) => {
    if (!window.confirm(`Delete “${name}”? This cannot be undone.`)) return;
    try {
      const res = await fetch(kind === 'folder' ? '/api/catalog/folders' : `/api/catalog/stories/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, ...(kind === 'folder' ? { body: JSON.stringify({ id }) } : {}) });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw Error(json.error);
      await load(); setMessage('Item deleted.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete this item.'); }
  };

  const moveStory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!moving) return;
    try {
      const res = await fetch(`/api/catalog/stories/${moving.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: destination || null }) });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw Error(json.error);
      setMoving(null); setDetails(null); await load(); setMessage('Story moved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not move story.'); }
  };

  const folderMap = new Map(data.folders.map(folder => [folder.id, folder]));
  let node = current ? folderMap.get(current) : undefined;
  const crumbs: FolderItem[] = [];
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) { seen.add(node.id); crumbs.unshift(node); node = node.parentId ? folderMap.get(node.parentId) : undefined; }
  const children = data.folders.filter(folder => folder.parentId === current);
  const roots = data.folders.filter(folder => !folder.parentId);
  const title = query ? 'Search results' : current ? folderMap.get(current)?.name || 'Folder' : 'Shared library';
  const hasFilters = Object.values(filters).some(value => value.trim());
  const isEmptyLocation = !loading && !query && !hasFilters && children.length === 0 && data.files.length === 0;

  return <div className="app-shell" data-appearance={preferences.appearance} data-density={preferences.density} data-sidebar={preferences.sidebar} onDragOver={event => { event.preventDefault(); setDrag(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDrag(false); }} onDrop={event => { event.preventDefault(); setDrag(false); void uploadFiles(event.dataTransfer.files); }}>
    {mobileSidebarOpen && <button className="sidebar-backdrop" type="button" tabIndex={-1} aria-label="Close sidebar" onClick={() => { setMobileSidebarOpen(false); mobileSidebarTrigger.current?.focus(); }}/>}
    <aside id="library-sidebar" className="sidebar" ref={sidebarRef} data-mobile-open={mobileSidebarOpen} role={mobileSidebarOpen ? 'dialog' : undefined} aria-modal={mobileSidebarOpen ? true : undefined} aria-label="Library navigation" onClick={event => { if (mobileSidebarOpen && event.target instanceof Element && event.target.closest('button.side-link')) { setMobileSidebarOpen(false); mobileSidebarTrigger.current?.focus(); } }}>
      <div className="sidebar-top"><div className="sidebar-heading">Library</div><button className="desktop-sidebar-toggle sidebar-toggle-in-rail" type="button" aria-label={preferences.sidebar === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar'} title={preferences.sidebar === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar'} aria-controls="library-sidebar" aria-expanded={preferences.sidebar === 'expanded'} onClick={() => updatePreferences({ sidebar: preferences.sidebar === 'expanded' ? 'collapsed' : 'expanded' })}>{preferences.sidebar === 'expanded' ? <PanelLeftClose size={19}/> : <PanelLeftOpen size={19}/>}</button><button className="mobile-sidebar-close rail-icon" type="button" aria-label="Close sidebar" onClick={() => { setMobileSidebarOpen(false); mobileSidebarTrigger.current?.focus(); }}><X size={19}/></button></div>
      <div className="side-label">BROWSE</div>
      <button className={`side-link ${!current && !query ? 'active' : ''}`} aria-label="My library" title="My library" onClick={() => openFolder(null)}><HardDrive size={18}/><span>Library</span></button>
      <button className="side-link" onClick={() => { setFavoriteStory(null); setFavoritesOpen(true); }}><Heart size={18}/><span>My collections</span></button>
      <button className="side-link" onClick={() => setContinueOpen(true)}><FileText size={18}/><span>Continue reading</span></button>
      {user.role !== 'user' && <button className="side-link" onClick={() => setRequestsOpen(true)}><FileText size={18}/><span>Removal requests</span></button>}
      {user.role === 'admin' && <button className="side-link" onClick={() => setUsersOpen(true)}><FileText size={18}/><span>Manage users</span></button>}
      {user.role === 'admin' && <button className="side-link" onClick={() => setDriveOpen(true)}><HardDrive size={18}/><span>Import from Drive</span></button>}
      {user.role === 'admin' && <button className="side-link" onClick={() => setNotificationIssuesOpen(true)}><FileText size={18}/><span>Pending tasks</span></button>}
      <button className="side-link" onClick={() => setTrackerOpen(true)}><FileText size={18}/><span>AO3 status</span></button>
      <div className="side-heading"><span>FOLDERS</span><span className="side-count">{loading ? '—' : roots.length}</span></div>
      <div className="side-folders">{roots.length ? roots.map(folder => <button key={folder.id} className={`side-link folder-link ${current === folder.id ? 'active' : ''}`} aria-label={folder.name} title={folder.name} onClick={() => openFolder(folder.id)}><Folder size={17}/><span>{folder.name}</span></button>) : <p className="side-empty">No folders yet</p>}</div>
      <div className="sidebar-bottom"><div className="sidebar-account"><span className="avatar" role="img" aria-label={`Account: ${user.name}`} title={user.name}>{user.name.slice(0, 1).toUpperCase()}</span><span className="sidebar-account-copy"><strong>{user.name}</strong><small>{user.email}</small></span><button className="rail-icon" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={17}/></button></div></div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="topbar-leading">
          <button className="sidebar-toggle mobile-sidebar-toggle" ref={mobileSidebarTrigger} type="button" aria-label="Open sidebar" title="Open sidebar" aria-controls="library-sidebar" aria-expanded={mobileSidebarOpen} onClick={() => setMobileSidebarOpen(true)}><PanelLeftOpen size={19}/><span>Menu</span></button>
          <button className="mobile-brand" onClick={() => openFolder(null)} aria-label="Go to library"><HardDrive size={19}/> Library</button>
        </div>
        <label className="search"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your library" aria-label="Search your library"/></label>
        <div className="topbar-right">
          <div className="customize-menu" ref={customizeRef}><button className="customize-trigger" type="button" aria-label="Customize library" aria-expanded={customizeOpen} aria-controls="customize-panel" onClick={() => setCustomizeOpen(!customizeOpen)}><SlidersHorizontal size={17}/><span>Customize</span></button>
            {customizeOpen && <div className="customize-popover" id="customize-panel"><div className="customize-heading"><strong>Customize your view</strong><span>Saved on this browser</span></div>
              <fieldset><legend>Appearance</legend><div className="appearance-options">
                {([{ value: 'blue', label: 'Light' }, { value: 'warm', label: 'Warm' }, { value: 'night', label: 'Dark' }] as const).map(option => <label key={option.value} className={`appearance-option ${preferences.appearance === option.value ? 'selected' : ''}`}><input type="radio" name="appearance" value={option.value} checked={preferences.appearance === option.value} onChange={() => updatePreferences({ appearance: option.value })}/><span className={`appearance-swatch ${option.value}`} aria-hidden="true"/><span>{option.label}</span></label>)}
              </div></fieldset>
              <fieldset><legend>Spacing</legend><div className="preference-segment">
                {([{value:'comfortable',label:'Comfortable'}, {value:'compact',label:'Compact'}] as const).map(option => <label key={option.value} className={preferences.density === option.value ? 'selected' : ''}><input type="radio" name="density" value={option.value} checked={preferences.density === option.value} onChange={() => updatePreferences({ density: option.value })}/>{option.label}</label>)}
              </div></fieldset>
              <fieldset><legend>Layout</legend><div className="preference-segment">
                {([{value:'list',label:'List'}, {value:'grid',label:'Grid'}] as const).map(option => <label key={option.value} className={view === option.value ? 'selected' : ''}><input type="radio" name="view" value={option.value} checked={view === option.value} onChange={() => updatePreferences({ view: option.value })}/>{option.label}</label>)}
              </div></fieldset>
            </div>}
          </div>
          <button className="workspace-mode-toggle" type="button" aria-label={preferences.appearance === 'night' ? 'Switch to light mode' : 'Switch to dark mode'} title={preferences.appearance === 'night' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => updatePreferences({ appearance: preferences.appearance === 'night' ? preferences.lightAppearance : 'night' })}>{preferences.appearance === 'night' ? <Sun size={17}/> : <Moon size={17}/>}<span>{preferences.appearance === 'night' ? 'Light mode' : 'Dark mode'}</span></button>
          <details className="account-menu"><summary aria-label="Account menu"><span className="top-avatar">{user.name.slice(0, 1).toUpperCase()}</span><ChevronDown size={14}/></summary><div className="account-popover"><strong>{user.name}</strong><span>{user.email}</span><button onClick={signOut}><LogOut size={15}/> Sign out</button><button onClick={() => setDeletingAccount(true)}>Remove my account</button></div></details>
        </div>
      </header>
      <div className="content">
        {(current || query) && <nav className="breadcrumbs" aria-label="Location"><button onClick={() => openFolder(null)}>Library</button>{crumbs.map(folder => <span key={folder.id}><ChevronRight size={14}/><button onClick={() => openFolder(folder.id)}>{folder.name}</button></span>)}{query && <span><ChevronRight size={14}/><span>Search</span></span>}</nav>}
        <div className="heading"><div><h1>{title}</h1><p>{query ? `Results for “${query}”` : current ? 'Documents and folders in this location.' : 'Browse the shared collection.'}</p></div>{!isEmptyLocation && <div className="actions"><button className="btn secondary" onClick={openNewFolder}><FolderPlus size={17}/> New folder</button><button className="btn primary" onClick={() => input.current?.click()} disabled={!!uploading}><Upload size={17}/> Upload files</button></div>}</div>
        <label className="catalog-sort">Sort by <select value={sort} onChange={event => setSort(event.target.value)}><option value="title">Title</option><option value="author">Author</option><option value="recent">Date added</option><option value="words">Words</option><option value="chapters">Chapters</option></select></label>
        <button type="button" className="btn secondary" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={17}/> Filters</button>
        {filtersOpen && <div className="catalog-filters">{([{key:'fandom',label:'Fandom'}, {key:'relationship',label:"Relationship"}, {key:'include',label:'Include tag or warning'}, {key:'exclude',label:'Exclude tag or warning'}, {key:'rating',label:"Rating"}, {key:'category',label:"Category"}, {key:'characters',label:"Characters"}, {key:'language',label:'Original language'}, {key:'minWords',label:"Minimum words"}, {key:'maxWords',label:"Maximum words"}, {key:'minChapters',label:"Minimum chapters"}, {key:'maxChapters',label:"Maximum chapters"}] as const).map(field => <label key={field.key}>{field.label}<input value={filters[field.key]} inputMode={/^(min|max)/.test(field.key) ? 'numeric' : undefined} maxLength={/^(min|max)/.test(field.key) ? 10 : 120} onChange={event => setFilters(old => ({ ...old, [field.key]: /^(min|max)/.test(field.key) ? event.target.value.replace(/\D/g, '').slice(0, 10) : event.target.value }))}/></label>)}<label>Status<select value={filters.status} onChange={event => setFilters(old => ({ ...old, status: event.target.value }))}><option value="">All</option><option value="complete">Complete</option><option value="incomplete">In progress</option></select></label><button className="btn secondary" type="button" onClick={() => setFilters({ fandom: '', relationship: '', include: '', exclude: '', rating: '', category: '', characters: '', language: '', status: '', minWords: '', maxWords: '', minChapters: '', maxChapters: '' })}>Clean filters</button></div>}
        <input ref={input} type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" multiple hidden onChange={event => { if (event.target.files) void uploadFiles(event.target.files); }}/>
        {message && <div role="status" className="notice"><span>{message}</span><button className="icon-btn" onClick={() => setMessage('')} aria-label="Dismiss message"><X size={16}/></button></div>}
        {uploading && <div role="status" className="notice"><LoaderCircle className="spin" size={17}/><span>{uploading}</span></div>}
        {isEmptyLocation ? <section className="library-empty-state" aria-labelledby="empty-library-title">
          <div className="empty-state-copy"><h2 id="empty-library-title">Add a document</h2><p>Upload your PDFs and EPUBs, or create a folder to organize them.</p>
            <div className="empty-state-actions"><button className="btn primary" onClick={() => input.current?.click()} disabled={!!uploading}><Upload size={17}/> Upload files</button><button className="btn secondary" onClick={openNewFolder}><FolderPlus size={17}/> New folder</button></div>
            <div className="empty-state-meta"><FileText size={15}/><span>PDF &amp; EPUB</span></div>
          </div>
          <div className="empty-state-art" aria-hidden="true"><div className="empty-art-back"/><div className="empty-art-middle"/><div className="empty-art-front"><FileText size={34} strokeWidth={1.4}/><span/><span/><span/></div></div>
        </section> : <>
        {!query && !hasFilters && <section className="folders-section"><div className="section-head"><div className="section-title"><h2>Folders</h2><span>{loading ? '—' : children.length}</span></div></div>
          {children.length ? <div className="folder-grid">{children.map((folder, index) => <div className="folder-card" key={folder.id}><button className="folder-open" onClick={() => openFolder(folder.id)}><span className={`folder-icon tint-${index % 4}`}><Folder size={21} fill="currentColor" strokeWidth={1.5}/></span><span className="folder-copy"><strong>{folder.name}</strong><small>Open folder</small></span><ArrowRight className="folder-arrow" size={16}/></button>{user.role === 'admin' && <button className="folder-edit icon-btn" aria-label={`Edit ${folder.name}`} title="Edit folder" onClick={() => setEditingFolder(folder)}><Pencil size={15}/></button>}{user.role === 'admin' && <button className="folder-delete icon-btn" aria-label={`Delete ${folder.name}`} title="Delete folder" onClick={() => remove(folder.id, 'folder', folder.name)}><Trash2 size={15}/></button>}</div>)}</div> : <div className="folders-empty"><Folder size={17}/><span>No folders in this location.</span></div>}
        </section>}
        <section className="files-section"><div className="section-head file-head"><div className="section-title"><h2>{query ? 'Search results' : 'Documents'}</h2><span>{loading ? '—' : `${data.files.length}${data.hasMore ? '+' : ''}`}</span></div><div className="view-toggle" role="group" aria-label="Display view"><button className={view === 'list' ? 'selected' : ''} onClick={() => updatePreferences({view:'list'})} aria-label="List view" aria-pressed={view === 'list'}><List size={17}/></button><button className={view === 'grid' ? 'selected' : ''} onClick={() => updatePreferences({view:'grid'})} aria-label="Grid view" aria-pressed={view === 'grid'}><LayoutGrid size={16}/></button></div></div>
          {loading ? <div className="empty"><LoaderCircle className="spin" size={23}/><p>Loading your library…</p></div> : data.files.length === 0 ? <div className="empty"><div className="empty-illustration" aria-hidden="true"><span/><span/><FileText size={28}/></div><h3>{query ? 'No files found' : 'No documents here yet'}</h3><p>{query ? 'Try searching for another file name.' : 'Upload a PDF or EPUB to add it to this location.'}</p></div> : <div className={view === 'grid' ? 'file-grid' : 'file-list'}>{view === 'list' && <div className="table-header"><span>NAME</span><span>ADDED</span><span>SIZE</span><span/></div>}{data.files.map(file => <div className="file-row" key={file.id}><button className="file-name" onClick={() => setDetails(file)}><span className={`file-icon ${file.type}`}><FileText size={19}/></span><span><strong>{file.title || file.name}</strong><small>{file.type.toUpperCase()} · {fileSize(file.size)}</small></span></button><span className="file-date">{fileDate(file.createdAt)}</span><span className="file-size">{fileSize(file.size)}</span><div className="file-actions">{user.role === 'admin' && <button className="icon-btn" title="Delete" aria-label={`Delete ${file.name}`} onClick={() => remove(file.id, 'file', file.name)}><Trash2 size={16}/></button>}</div></div>)}</div>}
          {data.hasMore && <button className="load-more" onClick={() => void load(true)}>Load more files</button>}
        </section>
        </>}
      </div>
    </main>
    {drag && <div className="drag-overlay"><CloudUpload size={40}/><strong>Drop your files here</strong><span>They will be added to the current folder.</span></div>}
    {newFolder && <div className="modal-backdrop" onMouseDown={() => setNewFolder(false)}><form className="dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" onSubmit={createFolder} onKeyDown={event => { if (event.key === 'Escape') setNewFolder(false); }} onMouseDown={event => event.stopPropagation()}><div className="dialog-top"><div className="dialog-icon"><FolderPlus size={20}/></div><button type="button" className="icon-btn" aria-label="Close" onClick={() => setNewFolder(false)}><X size={19}/></button></div><h2 id="folder-dialog-title">Create a folder</h2><p>Give your new folder a name. You can add files to it anytime.</p><label htmlFor="folder-name">Folder name</label><input id="folder-name" autoFocus maxLength={180} value={folderName} onChange={event => { setFolderName(event.target.value); setFolderError(''); }} placeholder="e.g. Reading list"/>{folderError && <p className="form-error" role="alert">{folderError}</p>}<div className="dialog-actions"><button type="button" className="btn secondary" onClick={() => setNewFolder(false)}>Cancel</button><button className="btn primary" disabled={!folderName.trim()}>Create folder</button></div></form></div>}
    {details && !favoritesOpen && !moving && !reminderStory && !removalStory && !editingStory && <StoryDetails story={details} role={user.role} close={() => setDetails(null)} read={() => { setReader(details); setDetails(null); }} save={() => { setFavoriteStory(details); setFavoritesOpen(true); }} move={() => { setDestination(details.folderId || ''); setMoving(details); }} remind={() => setReminderStory(details)} remove={() => setRemovalStory(details)} edit={() => setEditingStory(details)}/>}

    {moving && <div className="modal-backdrop" onMouseDown={() => setMoving(null)}><form className="dialog" role="dialog" aria-modal="true" aria-labelledby="move-story-title" onSubmit={moveStory} onMouseDown={event => event.stopPropagation()}><h2 id="move-story-title">Move story</h2><label htmlFor="move-destination">Destination folder</label><select id="move-destination" value={destination} onChange={event => setDestination(event.target.value)}><option value="">Library root</option>{data.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><div className="dialog-actions"><button type="button" className="btn secondary" onClick={() => setMoving(null)}>Cancel</button><button className="btn primary">Move</button></div></form></div>}
    {favoritesOpen && <FavoritesDialog story={favoriteStory} close={() => setFavoritesOpen(false)} openStory={file => { setFavoritesOpen(false); setDetails(file); }}/>}
    {removalStory && <RemovalDialog story={removalStory} close={() => setRemovalStory(null)}/>}
    {requestsOpen && <RemovalRequests role={user.role} close={() => setRequestsOpen(false)} onChanged={() => void load()}/>}
    {usersOpen && <UserAdministration currentUserId={user.id} close={() => setUsersOpen(false)}/>}
    {reminderStory && <ReminderDialog story={reminderStory} close={() => setReminderStory(null)}/>}
    {trackerOpen && <TrackerDialog close={() => setTrackerOpen(false)}/>}
    {deletingAccount && <DeleteAccount userId={user.id} close={() => setDeletingAccount(false)}/>}
    {driveOpen && <DriveImport close={() => { setDriveOpen(false); void load(); }}/>}
    {continueOpen && <ContinueReading close={() => setContinueOpen(false)} open={file => { setContinueOpen(false); setReader(file); }}/>}
    {editingStory && <StoryEditDialog story={editingStory} close={() => setEditingStory(null)} saved={() => { setEditingStory(null); setDetails(null); void load(); }}/> }
    {notificationIssuesOpen && <NotificationIssues close={() => setNotificationIssuesOpen(false)}/>}
    {editingFolder && <FolderEditDialog folder={editingFolder} folders={data.folders} close={() => setEditingFolder(null)} saved={() => { setEditingFolder(null); void load(); }}/>}
    {reader && <Reader key={reader.id} file={reader} appearance={preferences.appearance} setAppearance={value => updatePreferences({ appearance: value })} close={() => setReader(null)}/>}
  </div>;
}

function FolderEditDialog({ folder, folders, close, saved }: { folder: FolderItem; folders: FolderItem[]; close: () => void; saved: () => void }) {
 const [name, setName] = useState(folder.name);
 const [parent, setParent] = useState(folder.parentId || '');
 const [message, setMessage] = useState('');
 async function submit(event: React.FormEvent) {
  event.preventDefault();
  const res = await fetch('/api/catalog/folders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: folder.id, name, parentId: parent || null }) });
  if (!res.ok) { const data = await res.json() as { error?: string }; setMessage(data.error || 'Could not update the folder.'); return; }
  saved();
 }
 return <div className="modal-backdrop" onMouseDown={close}><form className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-folder-title" onMouseDown={event => event.stopPropagation()} onSubmit={submit}><h2 id="edit-folder-title">Edit folder</h2><label htmlFor="folder-edit-name">Name</label><input id="folder-edit-name" value={name} maxLength={180} required onChange={event => setName(event.target.value)}/><label htmlFor="folder-edit-parent">Parent folder</label><select id="folder-edit-parent" value={parent} onChange={event => setParent(event.target.value)}><option value="">Library root</option>{folders.filter(item => item.id !== folder.id).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>{message && <p role="alert">{message}</p>}<div className="dialog-actions"><button type="button" className="btn secondary" onClick={close}>Cancel</button><button className="btn primary">Save</button></div></form></div>;
}

function StoryEditDialog({ story, close, saved }: { story: FileItem; close: () => void; saved: () => void }) {
 const fields = [{ key: 'title', label: "Title" }, { key: 'author', label: 'Author' }, { key: 'summary', label: 'Author summary' }, { key: 'fandom', label: 'Fandom' }, { key: 'relationship', label: "Relationship" }, { key: 'tags', label: 'Tags' }, { key: 'warnings', label: "Warnings" }, { key: 'language', label: 'Language' }, { key: 'rating', label: "Rating" }, { key: 'category', label: "Category" }, { key: 'characters', label: "Characters" }] as const;
 const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(field => [field.key, String(story[field.key] || '')])));
 const [message, setMessage] = useState('');
 async function submit(event: React.FormEvent) {
  event.preventDefault();
  try {
   const metadata = Object.fromEntries(fields.filter(field => values[field.key] !== String(story[field.key] || '')).map(field => [field.key, values[field.key]]));
   if (!Object.keys(metadata).length) { saved(); return; }
   const res = await fetch(`/api/catalog/stories/${story.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata }) });
   if (!res.ok) throw new Error('Could not save the details.');
   saved();
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the details.'); }
 }
 return <div className="modal-backdrop" onMouseDown={close}><form className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-story-title" onMouseDown={event => event.stopPropagation()} onSubmit={submit}><h2 id="edit-story-title">Edit details</h2>{fields.map(field => <label key={field.key}>{field.label}{field.key === 'summary' ? <textarea maxLength={12000} value={values[field.key]} onChange={event => setValues(old => ({ ...old, [field.key]: event.target.value }))}/> : <input required={field.key === 'title'} maxLength={3000} value={values[field.key]} onChange={event => setValues(old => ({ ...old, [field.key]: event.target.value }))}/>}</label>)}{message && <p role="alert">{message}</p>}<div className="dialog-actions"><button type="button" className="btn secondary" onClick={close}>Cancel</button><button className="btn primary">Save</button></div></form></div>;
}

function StoryDetails({ story, role, close, read, save, move, remind, remove, edit }: { story: FileItem; role: Account['role']; close: () => void; read: () => void; save: () => void; move: () => void; remind: () => void; remove: () => void; edit: () => void }) {
  const [languages, setLanguages] = useState<{ language: string; name: string }[]>([]);
  const [language, setLanguage] = useState('es');
  const [showOptions, setShowOptions] = useState(false);
  const [translated, setTranslated] = useState<Partial<FileItem> | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [message, setMessage] = useState('');
  const translationRequest = useRef<AbortController | null>(null);
  const languageChanged = useRef(false);
  useEffect(() => { let cancelled = false; void fetch('/api/me/language').then(res => res.ok ? res.json() as Promise<{ language: string }> : null).then(data => { if (!cancelled && !languageChanged.current && data) setLanguage(data.language); }).catch(() => {}); return () => { cancelled = true; translationRequest.current?.abort(); translationRequest.current = null; }; }, []);
  async function options() {
    setShowOptions(true);
    if (languages.length) return;
    try {
      const res = await fetch('/api/translations/languages');
      const data = await res.json() as { languages?: typeof languages; error?: string };
      if (!res.ok) throw new Error(data.error || 'Could not load languages.');
      setLanguages(data.languages || []);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load languages.'); }
  }
  async function translate() {
    translationRequest.current?.abort();
    const controller = new AbortController(); translationRequest.current = controller;
    setTranslating(true); setMessage('Translating ficha…');
    try {
      const fields = ['title', 'author', 'summary', 'fandom', 'relationship', 'tags', 'warnings', 'language', 'rating', 'category', 'characters'] as const;
      const entries = await Promise.all(fields.map(async key => {
        const source = story[key];
        if (!source) return [key, source] as const;
        const chunks = await Promise.all(splitTranslationText(source).map(async text => {
          const res = await fetch('/api/translations/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, target: language, storyId: story.id }), signal: controller.signal });
          if (!res.ok) throw new Error('Could not translate the details.');
          const data = await res.json() as { text: string };
          return data.text;
        }));
        return [key, chunks.join(' ')] as const;
      }));
      if (translationRequest.current === controller && !controller.signal.aborted) { setTranslated(Object.fromEntries(entries)); setShowTranslated(true); setMessage("Automatic translation."); }
    } catch (error) {
      if (translationRequest.current === controller && !controller.signal.aborted) { controller.abort(); setMessage(error instanceof Error ? error.message : 'Could not translate the details.'); }
    } finally { if (translationRequest.current === controller) { translationRequest.current = null; setTranslating(false); } }
  }
  const item = showTranslated && translated ? { ...story, ...translated } : story;
  return <div className="modal-backdrop" onMouseDown={close}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="story-detail-title" onMouseDown={event => event.stopPropagation()}><div className="dialog-top"><div className="dialog-icon"><FileText size={20}/></div><button type="button" className="icon-btn" aria-label="Close" onClick={close}><X size={19}/></button></div><h2 id="story-detail-title">{item.title || item.name}</h2><p>{item.author || 'Author unavailable'}</p><h3>Summary</h3><p style={{ whiteSpace: 'pre-wrap' }}>{item.summary || 'Not available.'}</p><p><strong>Fandom:</strong> {item.fandom || 'Not available'}</p><p><strong>Relationship:</strong> {item.relationship || 'Not available'}</p><p><strong>Tags:</strong> {item.tags || 'Not available'}</p><p><strong>Warnings:</strong> {item.warnings || 'Not available'}</p><p><strong>Rating:</strong> {item.rating || 'Not available'}</p><p><strong>Characters:</strong> {item.characters || 'Not available'}</p><p><strong>Language:</strong> {item.language || 'Not available'}</p><p><strong>Words:</strong> {item.wordCount ?? 'Not available'} · <strong>Chapters:</strong> {item.chapterCount ?? '?'} / {item.totalChapters ?? '?'}</p>{item.ao3Url && <p><a href={item.ao3Url} target="_blank" rel="noopener noreferrer">Open in AO3</a></p>}
    <button type="button" className="access-inline-action" onClick={() => void options()}>Translate details</button>{showOptions && <><label htmlFor="story-language">Language</label><select id="story-language" value={language} onChange={event => { const value = event.target.value; languageChanged.current = true; translationRequest.current?.abort(); translationRequest.current = null; setTranslating(false); setTranslated(null); setShowTranslated(false); setMessage(''); setLanguage(value); void fetch('/api/me/language', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: value }) }); }}>{languages.map(item => <option key={item.language} value={item.language}>{item.name || item.language}</option>)}</select><button type="button" className="btn secondary" disabled={!languages.length || translating} onClick={() => void translate()}>{translating ? 'Translating…' : 'Translate'}</button>{translated && <button type="button" className="btn secondary" onClick={() => setShowTranslated(!showTranslated)}>{showTranslated ? 'View original' : "See translation"}</button>}</>}{message && <p role="status">{message}</p>}
    <button type="button" className="access-inline-action" onClick={remind}>Remind me to leave kudos or a comment</button><button type="button" className="access-inline-action" onClick={remove}>Request removal of this story</button><div className="dialog-actions">{role === 'admin' && <button type="button" className="btn secondary" onClick={edit}>Edit details</button>}<button type="button" className="btn secondary" onClick={save}>Save</button>{role !== 'user' && <button type="button" className="btn secondary" onClick={move}>Move</button>}<button type="button" className="btn primary" onClick={read}>Read</button></div>
  </section></div>;
}

export function ReminderDialog({ story, close, initialAction = 'kudo' }: { story: FileItem; close: () => void; initialAction?: 'kudo' | 'comment' }) {
  const [action, setAction] = useState<'kudo' | 'comment'>(initialAction);
  const [comment, setComment] = useState(''), [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || saved) return;
    setSaving(true); setMessage('');
    try {
      const res = await fetch('/api/reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyId: story.id, action, comment }) });
      if (!res.ok) throw new Error('Could not save the reminder.');
      setSaved(true); setMessage("Reminder saved. We will email you when AO3 returns after a confirmed outage.");
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the reminder.'); }
    finally { setSaving(false); }
  }
  return <div className="modal-backdrop" onMouseDown={close}><form className="dialog reminder-dialog" role="dialog" aria-modal="true" aria-labelledby="reminder-title" onMouseDown={event => event.stopPropagation()} onSubmit={submit}>
    <div className="reminder-header"><div><h2 id="reminder-title">Remember on AO3</h2><p>{story.title}</p></div><button type="button" className="icon-btn" aria-label="Close" onClick={close}><X size={20}/></button></div>
    <div className="reminder-choices" aria-label="Reminder type"><button type="button" aria-pressed={action === 'kudo'} disabled={saving || saved} onClick={() => { setAction('kudo'); setMessage(''); }}>Leave kudos</button><button type="button" aria-pressed={action === 'comment'} disabled={saving || saved} onClick={() => { setAction('comment'); setMessage(''); }}>Leave a comment</button></div>
    {action === 'comment' && <><label htmlFor="reminder-comment">Your comment</label><textarea id="reminder-comment" required maxLength={10000} disabled={saving || saved} value={comment} onChange={event => setComment(event.target.value)} placeholder="Write down what you'd like to tell the author..."/></>}
    <p className="reminder-explanation">When AO3 becomes available after a confirmed outage, we will email your reminders to you. You decide when to leave kudos or post your comment on AO3.</p>
    {!story.ao3Url && <p className="reminder-link-notice">We still don&apos;t have an AO3 link for this story.</p>}
    {message && <p className="reminder-message" role="status">{message}</p>}
    <div className="dialog-actions"><button type="button" className="btn secondary" onClick={close}>Close</button><button className="btn primary" disabled={saving || saved}>{saving ? 'Saving…' : saved ? 'Saved' : "Save reminder"}</button></div>
  </form></div>;
}
export function TrackerDialog({ close, inline = false }: { close: () => void; inline?: boolean }) {
  const [status, setStatus] = useState<{ state: string; lastCheckedAt: number | null; source?: 'monitor' | 'live' | 'official'; incident?: { name: string; update: string; updatedAt: string | null } | null }>({ state: 'unknown', lastCheckedAt: null });
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [statusRevision, setStatusRevision] = useState(0);
  const [reminders, setReminders] = useState<{ id: string; title: string; action: string; comment: string | null }[]>([]);
  const [pages, setPages] = useState<({ createdAt: number; id: string } | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [nextCursor, setNextCursor] = useState<{ createdAt: number; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [remindersUnavailable, setRemindersUnavailable] = useState(false);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const currentCursor = pages[page];
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/ao3/status');
        if (!res.ok) throw new Error('Could not check AO3 status.');
        const data = await res.json() as typeof status;
        if (!cancelled) { setStatus(data); setStatusError(''); }
      } catch (error) { if (!cancelled) { setStatus({ state: 'unknown', lastCheckedAt: null }); setStatusError(error instanceof Error ? error.message : 'Could not check the status.'); } }
      finally { if (!cancelled) setStatusLoading(false); }
    };
    void load(); const timer = window.setInterval(() => void load(), 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [statusRevision]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (currentCursor) { params.set('afterTime', String(currentCursor.createdAt)); params.set('afterId', currentCursor.id); }
        const res = await fetch(`/api/reminders?${params}`);
        if (!res.ok) throw new Error('Could not load reminders.');
        const data = await res.json() as { reminders: typeof reminders; nextCursor: typeof nextCursor };
        if (!cancelled) { setReminders(data.reminders); setNextCursor(data.nextCursor); setRemindersUnavailable(false); setMessage(''); }
      } catch (error) { if (!cancelled) { setRemindersUnavailable(true); setMessage(error instanceof Error ? error.message : 'Could not load reminders.'); } }
      finally { if (!cancelled) setLoading(false); }
    };
    void load(); const timer = window.setInterval(() => void load(), 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [currentCursor, revision]);
  async function remove(id: string) {
    try {
      const res = await fetch('/api/reminders', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (!res.ok) throw new Error('Could not delete the reminder.');
      setReminders(old => old.filter(item => item.id !== id)); setRevision(value => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete the reminder.'); }
  }
  const content = <>
    <div className="ao3-status-card" role="status" aria-live="polite">
      <div className="ao3-status-heading"><span className={`ao3-status-dot ao3-status-${statusLoading || statusError ? 'unknown' : status.state}`} aria-hidden="true"/><div><span className="ao3-status-label">AO3 AVAILABILITY</span><h2>{statusLoading ? 'Checking…' : status.state === 'up' ? 'Available' : status.state === 'maintenance' ? 'Under maintenance' : status.state === 'degraded' ? 'Partial outage' : status.state === 'down' ? 'Not available' : 'Status unknown'}</h2></div></div>
      <p>{statusLoading ? 'Checking AO3 status.' : status.source === 'official' ? "Status published by the AO3 team." : status.state === 'up' ? "AO3 responded to the last check." : status.state === 'down' ? "AO3 returned a server error. It may be undergoing maintenance or experiencing an issue." : "It is not possible to confirm whether AO3 is available or in maintenance."}</p>
      <p className="ao3-status-time">{status.lastCheckedAt ? `Last checked: ${new Date(status.lastCheckedAt).toLocaleString('en-US')}` : "No check available."}{status.source === 'live' && ' · Live check'}{status.source === 'official' && ' · Official source'}</p>
      {statusError && <p role="alert">{statusError}</p>}
      <button type="button" className="folio-secondary" disabled={statusLoading} onClick={() => { setStatusLoading(true); setStatusRevision(value => value + 1); }}>Refresh status</button>
      <p className="ao3-status-hint">It is updated every minute while this section is open. <a href="https://www.otwstatus.org/" target="_blank" rel="noreferrer">See official status page</a></p>
    </div>
    {status.incident && <section className="ao3-reminders" aria-labelledby="ao3-incident-title"><h2 id="ao3-incident-title">Official update</h2><p><strong>{status.incident.name}</strong>{status.incident.updatedAt && !Number.isNaN(Date.parse(status.incident.updatedAt)) ? ` · ${new Date(status.incident.updatedAt).toLocaleString('en-US')}` : ''}</p>{status.incident.update && <><p>Original message in English:</p><p className="ao3-incident-update" lang="en">{status.incident.update}</p></>}</section>}
    <section className="ao3-reminders" aria-labelledby="ao3-reminders-title"><h2 id="ao3-reminders-title">My reminders</h2><p>Receive your reminders when AO3 becomes available after a confirmed outage.</p>
      {loading ? <p role="status">Loading reminders…</p> : reminders.length ? reminders.map(item => <div className="ao3-reminder" key={item.id}><strong>{item.title}</strong><p>{item.action === 'kudo' ? "Leave kudos" : item.comment}</p><button type="button" className="access-inline-action" onClick={() => void remove(item.id)}>Delete reminder</button></div>) : !remindersUnavailable && <p>{page ? "There are no reminders left on this page." : 'You have no pending reminders.'}</p>}
      {(page > 0 || nextCursor) && <div className="dialog-actions"><button type="button" className="folio-secondary" disabled={loading || page === 0} onClick={() => { setLoading(true); setReminders([]); setNextCursor(null); setPage(value => value - 1); }}>Previous</button><span>Page {page + 1}</span><button type="button" className="folio-secondary" disabled={loading || !nextCursor} onClick={() => { if (!nextCursor) return; setLoading(true); setReminders([]); setPages(old => [...old.slice(0, page + 1), nextCursor]); setNextCursor(null); setPage(value => value + 1); }}>Next</button></div>}
      {message && <p role="alert">{message}</p>}{remindersUnavailable && <button type="button" className="folio-secondary" onClick={() => { setLoading(true); setRevision(value => value + 1); }}>Retry</button>}
    </section>
  </>;
  if (inline) return <div className="ao3-tracker">{content}</div>;
  return <div className="modal-backdrop" onMouseDown={close}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="tracker-title" onMouseDown={event => event.stopPropagation()}><h2 id="tracker-title">AO3 status</h2>{content}<button type="button" className="btn secondary" onClick={close}>Close</button></section></div>;
}

export function ContinueReading({ close, open, inline = false, renderStory }: { close: () => void; open: (file: FileItem) => void; inline?: boolean; renderStory?: (file: FileItem) => React.ReactNode }) {
 const [stories, setStories] = useState<FileItem[]>([]);
 const [message, setMessage] = useState('');
 const [cursor, setCursor] = useState<{ createdAt: number; id: string } | null>(null);
 const [loading, setLoading] = useState(true);
 const [search, setSearch] = useState(''), [rating, setRating] = useState(''), [category, setCategory] = useState(''), [status, setStatus] = useState('');
 const [options, setOptions] = useState<{ ratings: string[]; categories: string[] }>({ ratings: [], categories: [] });
 const request = useRef<AbortController | null>(null);
 const filtersActive = !!(search.trim() || rating || category || status);
 function beginFilterChange() { request.current?.abort(); setLoading(true); setMessage(''); setStories([]); setCursor(null); }
 useEffect(() => {
  const controller = new AbortController(); request.current = controller;
  const timer = window.setTimeout(() => {
   const params = new URLSearchParams({ q: search, rating, category, status });
   void fetch(`/api/reading?${params}`, { signal: controller.signal }).then(async res => { if (!res.ok) throw new Error('Could not load progress.'); return res.json() as Promise<{ stories: ({ filename: string; fileType: 'pdf' | 'epub' } & FileItem)[]; nextCursor: typeof cursor; options: typeof options }>; }).then(data => { if (!controller.signal.aborted) { setStories(data.stories.map(item => ({ ...item, name: item.filename, type: item.fileType }))); setCursor(data.nextCursor); setOptions(data.options); } }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Could not load progress.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, 250);
  return () => { window.clearTimeout(timer); controller.abort(); request.current?.abort(); };
 }, [search, rating, category, status]);
 async function loadMore() {
  if (!cursor || loading) return;
  setLoading(true); setMessage('');
  const controller = new AbortController(); request.current = controller;
  try {
   const params = new URLSearchParams({ q: search, rating, category, status, afterTime: String(cursor.createdAt), afterId: cursor.id });
   const res = await fetch(`/api/reading?${params}`, { signal: controller.signal });
   if (!res.ok) throw new Error("Could not load more reading.");
   const data = await res.json() as { stories: ({ filename: string; fileType: 'pdf' | 'epub' } & FileItem)[]; nextCursor: typeof cursor };
   if (!controller.signal.aborted) { setStories(old => [...old, ...data.stories.map(item => ({ ...item, name: item.filename, type: item.fileType }))]); setCursor(data.nextCursor); }
  } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not load more reading."); }
  finally { if (!controller.signal.aborted) setLoading(false); }
 }
 const content = <><h2 id="continue-title">Continue reading</h2><p>Continue reading where you left off.</p>{inline && <div className="collection-filters">
  <label>Search my reading<input type="search" value={search} maxLength={120} onChange={event => { beginFilterChange(); setSearch(event.target.value); }} placeholder="Title, author, fandom, relationship, or tag"/></label>
  <div className="collection-filter-row">
   <label>Rating<select value={rating} onChange={event => { beginFilterChange(); setRating(event.target.value); }}><option value="">All</option>{options.ratings.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
   <label>Category<select value={category} onChange={event => { beginFilterChange(); setCategory(event.target.value); }}><option value="">All</option>{options.categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
   <label>Status<select value={status} onChange={event => { beginFilterChange(); setStatus(event.target.value); }}><option value="">All</option><option value="complete">Complete</option><option value="incomplete">In progress</option></select></label>
  </div>
  {filtersActive && <div className="collection-filter-summary"><button type="button" className="access-inline-action" onClick={() => { beginFilterChange(); setSearch(''); setRating(''); setCategory(''); setStatus(''); }}>Clean filters</button></div>}
 </div>}{stories.length > 0 && <div className={inline && renderStory ? 'collection-card-list personal-reading-list' : undefined}>{stories.map(story => inline && renderStory ? <article key={story.id}>{renderStory(story)}</article> : <div className="personal-reading-item" key={story.id}><button type="button" className="access-inline-action" onClick={() => open(story)}>{story.title}</button></div>)}</div>}{loading && <p role="status">Loading reading…</p>}{!loading && !stories.length && !message && <p>{filtersActive ? "No stories match those filters." : "You have no saved reading yet."}</p>}{cursor && <button type="button" className="btn secondary personal-reading-more" disabled={loading} onClick={() => void loadMore()}>Load more</button>}{message && <p role="alert">{message}</p>}{!inline && <button type="button" className="btn secondary" onClick={close}>Close</button>}</>;
 if (inline) return <section className="dialog personal-content personal-reading-content" aria-labelledby="continue-title">{content}</section>;
 return <div className="modal-backdrop" onMouseDown={close}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="continue-title" onMouseDown={event => event.stopPropagation()}>{content}</section></div>;
}

export function ReadingNotes({ storyId, location, close, jump }: { storyId: string; location: string; close: () => void; jump: (location: string) => void }) {
 const [notes, setNotes] = useState<{ id: string; location: string; text: string | null }[]>([]);
 const [text, setText] = useState('');
 const [message, setMessage] = useState('');
 useEffect(() => {
  let cancelled = false;
  void fetch(`/api/reading/${storyId}/notes`).then(async res => { if (!res.ok) throw new Error('Could not load notes.'); return res.json() as Promise<{ notes: typeof notes }>; }).then(data => { if (!cancelled) setNotes(data.notes); }).catch(error => { if (!cancelled) setMessage(error.message); });
  return () => { cancelled = true; };
 }, [storyId]);
 async function add(event: React.FormEvent) {
  event.preventDefault();
  const res = await fetch(`/api/reading/${storyId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location, text }) });
  if (!res.ok) { setMessage("Could not save."); return; }
  const data = await res.json() as { id: string }; setNotes(old => [{ id: data.id, location, text: text.trim() || null }, ...old]); setText('');
 }
 async function remove(noteId: string) {
  const res = await fetch(`/api/reading/${storyId}/notes`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId }) });
  if (res.ok) setNotes(old => old.filter(note => note.id !== noteId)); else setMessage("Could not delete.");
 }
 const page = location.match(/^(html|pdf):(\d+)$/);
 const pageLabel = page ? `Page ${Number(page[2]) + (page[1] === 'html' ? 1 : 0)}` : "Current position";
 return <div className="modal-backdrop" onMouseDown={close}>
  <section className="dialog reading-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="notes-title" onMouseDown={event => event.stopPropagation()}>
   <header className="reading-notes-header"><div><h2 id="notes-title">Notes and bookmarks</h2><p>Your reading progress is saved automatically. Your notes and bookmarks are private.</p></div><button type="button" className="icon-btn reading-notes-close" aria-label="Close" onClick={close}><X size={20}/></button></header>
   <form className="reading-notes-form" onSubmit={add}>
    <div className="reading-notes-location"><span>BOOKMARK POSITION</span><strong>{pageLabel}</strong></div>
    <label htmlFor="reading-note">Note <span>(optional)</span></label>
    <textarea id="reading-note" maxLength={5000} value={text} onChange={event => setText(event.target.value)} placeholder="Write a note to remember this moment..."/>
    <div className="reading-notes-actions"><button type="submit" className="btn primary">Save bookmark</button></div>
   </form>
   {notes.length > 0 && <div className="reading-notes-saved"><h3>Saved <span>{notes.length}</span></h3>{notes.map(note => {
    const saved = note.location.match(/^(html|pdf):(\d+)$/);
    const savedLabel = saved ? `Page ${Number(saved[2]) + (saved[1] === 'html' ? 1 : 0)}` : 'Bookmark';
    return <div className="reading-notes-item" key={note.id}><button type="button" className="reading-notes-link" onClick={() => jump(note.location)}><span>{savedLabel}</span><strong>{note.text || 'Go to bookmark'}</strong></button><button type="button" className="icon-btn reading-notes-delete" aria-label={`Delete bookmark at ${savedLabel.toLowerCase()}`} onClick={() => void remove(note.id)}><Trash2 size={17}/></button></div>;
   })}</div>}
   {message && <p className="reading-notes-error" role="alert">{message}</p>}
  </section>
 </div>;
}

function UserAdministration({ currentUserId, close }: { currentUserId: string; close: () => void }) {
  const [users, setUsers] = useState<{ id: string; name: string; email: string; role: 'user' | 'moderator'; blocked: number }[]>([]);
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<{ createdAt: number; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');
  const searchVersion = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ search });
      void fetch(`/api/admin/users?${params}`).then(async res => { if (!res.ok) throw new Error('Could not load users.'); return res.json() as Promise<{ users: typeof users; nextCursor: typeof cursor }>; }).then(data => { if (!cancelled) { setUsers(data.users); setCursor(data.nextCursor); setLoading(false); } }).catch(error => { if (!cancelled) { setMessage(error.message); setLoading(false); } });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [search]);
  async function loadMore() {
    if (!cursor || loading) return;
    const version = searchVersion.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ search, afterTime: String(cursor.createdAt), afterId: cursor.id });
      const res = await fetch(`/api/admin/users?${params}`);
      if (!res.ok) throw new Error("Could not load more users.");
      const data = await res.json() as { users: typeof users; nextCursor: typeof cursor };
      if (version === searchVersion.current) { setUsers(old => [...old, ...data.users]); setCursor(data.nextCursor); }
    } catch (error) { if (version === searchVersion.current) setMessage(error instanceof Error ? error.message : "Could not load more users."); }
    finally { if (version === searchVersion.current) setLoading(false); }
  }
  async function update(id: string, change: { role?: 'user' | 'moderator'; blocked?: boolean }) {
    setUpdating(true);
    try {
      const res = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id, ...change }) });
      if (!res.ok) throw new Error('Could not update the account.');
      setUsers(old => old.map(user => user.id === id ? { ...user, ...change, blocked: change.blocked === undefined ? user.blocked : Number(change.blocked) } : user));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update the account.'); }
    finally { setUpdating(false); }
  }
  return <div className="modal-backdrop" onMouseDown={close}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="users-title" onMouseDown={event => event.stopPropagation()}><h2 id="users-title">Manage users</h2>
    <label htmlFor="user-search">Search by name or email</label><input id="user-search" type="search" value={search} maxLength={120} onChange={event => { searchVersion.current++; setSearch(event.target.value); setUsers([]); setCursor(null); setMessage(''); setLoading(true); }}/>
    {users.filter(user => user.id !== currentUserId).map(user => <article key={user.id}><h3>{user.name}</h3><p>{user.email}</p><div className="dialog-actions"><button type="button" className="btn secondary" disabled={updating} onClick={() => void update(user.id, { role: user.role === 'moderator' ? 'user' : 'moderator' })}>{user.role === 'moderator' ? 'Remove moderator' : 'Make moderator'}</button><button type="button" className="btn secondary" disabled={updating} onClick={() => void update(user.id, { blocked: !user.blocked })}>{user.blocked ? 'Unblock' : 'Block'}</button></div></article>)}
    {loading && <p role="status">Loading users…</p>}{!loading && !users.length && <p>No users were found.</p>}{cursor && <button type="button" className="btn secondary" disabled={loading} onClick={() => void loadMore()}>Load more</button>}
    {message && <p role="alert">{message}</p>}<button type="button" className="btn secondary" onClick={close}>Close</button>
  </section></div>;
}

export function RemovalDialog({ story, close }: { story: FileItem; close: () => void }) {
  const [proof, setProof] = useState('');
  const [links, setLinks] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [emailStatus, setEmailStatus] = useState('pending');
  const [pending, setPending] = useState(false);
  const linkList = links.split('\n').map(link => link.trim()).filter(Boolean);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (pending) return;
    if (!proof.trim() && !linkList.length && !images.length) { setMessage("Add an explanation, link or image as proof."); return; }
    if (linkList.length > 5 || linkList.some(link => { try { const url = new URL(link); return !['http:', 'https:'].includes(url.protocol) || !!url.username || !!url.password || link.length > 2048; } catch { return true; } })) { setMessage("Add up to 5 valid links starting at http:// or https://, one per line."); return; }
    setMessage(''); setPending(true);
    try {
      const data = new FormData();
      data.set('storyId', story.id); data.set('storyDescription', story.title); data.set('proof', proof);
      linkList.forEach(link => data.append('links', link)); images.forEach(image => data.append('images', image));
      const res = await fetch('/api/removal-requests', { method: 'POST', body: data });
      if (!res.ok) { const body = await res.json().catch(() => null) as { error?: string } | null; throw new Error(body?.error || 'Could not submit the request.'); }
      const result = await res.json() as { emailStatus?: string };
      setEmailStatus(result.emailStatus || 'unknown'); setSent(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not submit the request.'); }
    finally { setPending(false); }
  }
  function addImages(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []); event.target.value = '';
    if (images.length + selected.length > 3) { setMessage("You can attach up to 3 images."); return; }
    if (selected.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 1.5 * 1024 * 1024)) { setMessage("Use PNG, JPEG or WebP images of up to 1.5 MB each."); return; }
    setMessage(''); setImages(current => [...current, ...selected]);
  }
  return <div className="modal-backdrop" onMouseDown={close}><form className="dialog removal-dialog" role="dialog" aria-modal="true" aria-labelledby="removal-title" onMouseDown={event => event.stopPropagation()} onSubmit={submit}>
    <h2 id="removal-title">Request removal</h2><p>Story: <strong>{story.title}</strong>. Tell us how we can verify that you are the author.</p>
    {sent ? <p role="status">{emailStatus === 'sent' ? "Your request was submitted for review and the email provider accepted the message." : emailStatus === 'pending' ? "Your request was saved for review; the email notification is pending." : "Your request was saved for review, but email delivery could not be confirmed."}</p> : <>
      <label htmlFor="removal-proof">Explanation <span>(optional)</span></label><textarea id="removal-proof" maxLength={10000} value={proof} onChange={event => setProof(event.target.value)} placeholder="Tell us how we can verify your authorship."/>
      <label htmlFor="removal-links">Evidence links <span>(optional)</span></label><textarea id="removal-links" className="removal-links" value={links} onChange={event => setLinks(event.target.value)} placeholder="https://…" aria-describedby="removal-links-help"/><p id="removal-links-help" className="removal-help">Up to 5 links, one per line. Check that those who check the application can open them.</p>
      <label htmlFor="removal-images">Attach images <span>(optional)</span></label><input id="removal-images" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addImages} aria-describedby="removal-images-help"/><p id="removal-images-help" className="removal-help">Up to 3 PNG, JPEG or 1.5 MB WebP images each.</p>
      {images.length > 0 && <ul className="removal-files">{images.map((image, index) => <li key={`${image.name}-${index}`}><span>{image.name}</span><button type="button" onClick={() => setImages(current => current.filter((_, i) => i !== index))} aria-label={`Quitar ${image.name}`}>Remove</button></li>)}</ul>}
      <p className="removal-help">Includes at least one explanation, a link or an image.</p>
    </>}
    {message && <p role="alert" className="removal-error">{message}</p>}<div className="dialog-actions">{!sent && <button className="btn primary" disabled={pending}>{pending ? 'Sending…' : 'Submit request'}</button>}<button type="button" className="btn secondary" onClick={close} disabled={pending}>Close</button></div>
  </form></div>;
}
export function RemovalRequests({ role, close, onChanged, onOpenStory }: { role: Account['role']; close: () => void; onChanged: () => void; onOpenStory?: (id: string, title: string, filename: string, author: string | null) => void }) {
  const [requests, setRequests] = useState<{ id: string; storyId: string | null; storyDescription: string; storyTitle: string | null; storyFilename: string | null; storyAuthor: string | null; storyAo3Url: string | null; proof: string; links: string[]; images: string[]; email: string; emailStatus: string | null }[]>([]);
  const [message, setMessage] = useState('');
  const [cursor, setCursor] = useState<{ createdAt: number; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/removal-requests').then(async res => { if (!res.ok) throw new Error('Could not load requests.'); return res.json() as Promise<{ requests: typeof requests; nextCursor: typeof cursor }>; }).then(data => { if (!cancelled) { setRequests(data.requests); setCursor(data.nextCursor); } }).catch(error => { if (!cancelled) setMessage(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true); setMessage('');
    try {
      const params = new URLSearchParams({ afterTime: String(cursor.createdAt), afterId: cursor.id });
      const res = await fetch(`/api/removal-requests?${params}`);
      if (!res.ok) throw new Error("Could not load more requests.");
      const data = await res.json() as { requests: typeof requests; nextCursor: typeof cursor };
      setRequests(old => [...old, ...data.requests]); setCursor(data.nextCursor);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load more requests."); }
    finally { setLoading(false); }
  }
  async function decide(request: typeof requests[number], decision: 'approve' | 'reject') {
    if (updating) return;
    if (!window.confirm(decision === 'approve' ? `Remove “${request.storyTitle || request.storyDescription}” from the library?` : "Reject this request?")) return;
    setUpdating(true); setMessage('');
    try {
      const res = await fetch(`/api/removal-requests/${request.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, storyId: request.storyId }) });
      if (!res.ok) throw new Error(res.status === 409 ? "The request or story changed. Close and reopen the review." : 'Could not resolve the request.');
      setRequests(old => old.filter(item => item.id !== request.id)); onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not resolve the request.'); }
    finally { setUpdating(false); }
  }
  return <div className="modal-backdrop" onMouseDown={close}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="requests-title" onMouseDown={event => event.stopPropagation()}><h2 id="requests-title">Removal requests</h2>
    {requests.map(request => <article key={request.id}><h3>{request.storyTitle || request.storyDescription}</h3>{request.storyId ? <><p>File: {request.storyFilename}</p><p>Author: {request.storyAuthor || 'Not available'}</p>{onOpenStory && <button type="button" className="btn secondary" onClick={() => onOpenStory(request.storyId!, request.storyTitle || request.storyDescription, request.storyFilename || '', request.storyAuthor)}>Read in the library</button>}{request.storyAo3Url && /^https:\/\/archiveofourown\.org\/works\/\d+$/.test(request.storyAo3Url) && <p><a href={request.storyAo3Url} target="_blank" rel="noopener noreferrer">Open in AO3</a></p>}</> : <p>The request is not linked to an available story.</p>}{request.storyTitle && request.storyDescription !== request.storyTitle && <p>Description sent: {request.storyDescription}</p>}<p>Requester: {request.email}</p>{request.emailStatus && request.emailStatus !== 'sent' && <p>Mail: {request.emailStatus === 'pending' || request.emailStatus === 'sending' ? "pending delivery" : request.emailStatus === 'failed' ? "delivery failed" : "delivery unconfirmed"}</p>}{request.proof && <p style={{ whiteSpace: 'pre-wrap' }}>{request.proof}</p>}{request.links?.length > 0 && <div className="removal-review-evidence"><strong>Evidence links</strong><ul>{request.links.map((link, index) => <li key={index}><a href={link} target="_blank" rel="noopener noreferrer">{link}</a></li>)}</ul></div>}{request.images?.length > 0 && <div className="removal-review-evidence"><strong>Attached images</strong><ul>{request.images.map((image, index) => <li key={image}><a href={`/api/removal-requests/${encodeURIComponent(request.id)}/images/${encodeURIComponent(image)}`} target="_blank" rel="noopener noreferrer">Open image {index + 1}</a></li>)}</ul></div>}{role === 'admin' && <div className="dialog-actions"><button type="button" className="btn secondary" disabled={updating} onClick={() => void decide(request, 'reject')}>Reject</button><button type="button" className="btn primary" disabled={updating || !request.storyId} onClick={() => void decide(request, 'approve')}>Approve and remove</button></div>}</article>)}
    {loading && <p role="status">Loading requests…</p>}{!loading && !requests.length && !cursor && !message && <p>No pending requests.</p>}{cursor && <button type="button" className="btn secondary" disabled={loading} onClick={() => void loadMore()}>Load more</button>}{message && <p role="alert">{message}</p>}<button type="button" className="btn secondary" onClick={close}>Close</button>
  </section></div>;
}

export function FavoritesDialog({ story, close, openStory, inline = false, renderStory }: { story: FileItem | null; close: () => void; openStory: (file: FileItem) => void; inline?: boolean; renderStory?: (file: FileItem) => React.ReactNode }) {
  const [collections, setCollections] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [items, setItems] = useState<FileItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState(''), [rating, setRating] = useState(''), [category, setCategory] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);
  const loadCollections = useCallback(async () => {
    const res = await fetch('/api/collections');
    if (!res.ok) throw new Error('Could not load collections.');
    const data = await res.json() as { collections: { id: string; name: string }[] };
    setCollections(data.collections);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/collections').then(async res => {
      if (!res.ok) throw new Error('Could not load collections.');
      return res.json() as Promise<{ collections: { id: string; name: string }[] }>;
    }).then(data => { if (!cancelled) setCollections(data.collections); }).catch(error => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!selected || story) return;
    let cancelled = false;
    void fetch(`/api/collections/${selected}/stories`).then(async res => {
      if (!res.ok) throw new Error("Could not load the collection.");
      const data = await res.json() as { stories: ({ filename: string; fileType: 'pdf' | 'epub' } & FileItem)[] };
      if (!cancelled) setItems(data.stories.map(item => ({ ...item, name: item.filename, type: item.fileType })));
    }).catch(error => { if (!cancelled) setMessage(error.message); }).finally(() => { if (!cancelled) setItemsLoading(false); });
    return () => { cancelled = true; };
  }, [selected, story]);
  async function create(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    try {
      const res = await fetch('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      if (!res.ok) throw new Error("Could not create the collection.");
      const data = await res.json() as { id: string };
      setName(''); await loadCollections(); setItemsLoading(!story); setSelected(data.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create the collection."); }
  }
  async function deleteCollection() {
    if (!selected || !window.confirm("Delete this collection from favorites?")) return;
    const res = await fetch(`/api/collections/${selected}`, { method: 'DELETE' });
    if (!res.ok) { setMessage("The collection could not be deleted."); return; }
    setSelected(''); setItems([]); await loadCollections();
  }
  async function change(storyId: string, method: 'POST' | 'DELETE') {
    try {
      const res = await fetch(`/api/collections/${selected}/stories`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyId }) });
      if (!res.ok) throw new Error("Could not update the collection.");
      if (method === 'DELETE') setItems(old => old.filter(item => item.id !== storyId));
      else setMessage("Story saved to the collection.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update the collection."); }
  }
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const terms = normalize(search.trim()).split(/\s+/).filter(Boolean);
  const ratings = [...new Set(items.map(item => item.rating?.trim()).filter((value): value is string => !!value))].sort();
  const categories = [...new Set(items.flatMap(item => (item.category || '').split(',').map(value => value.trim()).filter(Boolean)))].sort();
  const filtered = items.filter(item => {
    const searchable = normalize([item.title, item.name, item.author, item.summary, item.fandom, item.relationship, item.tags, item.characters, item.warnings, item.category].filter(Boolean).join(' '));
    const complete = item.totalChapters != null && item.chapterCount === item.totalChapters;
    const incomplete = item.chapterCount != null && (item.totalChapters == null || item.chapterCount < item.totalChapters);
    return terms.every(term => searchable.includes(term)) && (!rating || item.rating?.trim() === rating) && (!category || (item.category || '').split(',').some(value => value.trim() === category)) && (!status || (status === 'complete' ? complete : incomplete));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, totalPages);
  const visibleItems = inline ? filtered.slice((currentPage - 1) * 10, currentPage * 10) : items;
  const filtersActive = !!(search || rating || category || status);
  function clearCollectionFilters() { setSearch(''); setRating(''); setCategory(''); setStatus(''); setPage(1); }
  const content = <>
    {!inline && <div className="dialog-top"><div className="dialog-icon"><Heart size={20}/></div><button type="button" className="icon-btn" aria-label="Close" onClick={close}><X size={19}/></button></div>}
    <h2 id="favorites-title">My collections</h2><p className="collections-intro">{story ? <>Choose where to save <strong>{story.title}</strong>. Your collections are private.</> : "Only you can see your collections."}</p>
    {collections.length > 0 ? <div className="collection-picker"><label htmlFor="collection-select">Choose a collection</label><select id="collection-select" value={selected} onChange={event => { setSelected(event.target.value); setItemsLoading(!!event.target.value && !story); setItems([]); setMessage(''); clearCollectionFilters(); }}><option value="">Select a collection</option>{collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div> : <p className="collections-empty">You don&apos;t have collections yet, create one to start.</p>}
    {story && collections.length > 0 && <button type="button" className="btn primary collections-save" disabled={!selected} onClick={() => void change(story.id, 'POST')}>Save story</button>}
    {message && <p className="collections-message" role="status">{message}</p>}
    {!story && selected && <div className="collection-stories"><h3>Stories saved</h3>
      {inline && !itemsLoading && items.length > 0 && <div className="collection-filters">
        <label>Search in this collection<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Title, author, fandom, relationship, or tag"/></label>
        <div className="collection-filter-row">
          <label>Rating<select value={rating} onChange={event => { setRating(event.target.value); setPage(1); }}><option value="">All</option>{ratings.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Category<select value={category} onChange={event => { setCategory(event.target.value); setPage(1); }}><option value="">All</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Status<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All</option><option value="complete">Complete</option><option value="incomplete">In progress</option></select></label>
        </div>
        <div className="collection-filter-summary"><span aria-live="polite">{filtered.length} of {items.length} {items.length === 1 ? "story" : "stories"}</span>{filtersActive && <button type="button" className="access-inline-action" onClick={clearCollectionFilters}>Clean filters</button>}</div>
      </div>}
      {itemsLoading ? <p className="collection-empty-list" role="status">Loading stories…</p> : !items.length ? <p className="collection-empty-list">There are no stories in this collection.</p> : !visibleItems.length ? <p className="collection-empty-list">No stories match those filters.</p> : <div className={inline ? 'collection-card-list' : undefined}>{visibleItems.map(item => inline && renderStory ? <article className="collection-card" key={item.id}>{renderStory(item)}<button type="button" className="access-inline-action collection-remove" onClick={() => void change(item.id, 'DELETE')}>Remove from the collection<span className="sr-only">: {item.title}</span></button></article> : <div className="collection-item" key={item.id}><button type="button" className="collection-item-title" onClick={() => openStory(item)}>{item.title}</button><button type="button" className="icon-btn" aria-label={`Quitar ${item.title}`} onClick={() => void change(item.id, 'DELETE')}><X size={16}/></button></div>)}</div>}
      {inline && totalPages > 1 && <nav className="collection-pagination" aria-label="Pages of saved stories"><button type="button" className="btn secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span aria-live="polite">Page {currentPage} of {totalPages}</span><button type="button" className="btn secondary" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
    </div>}
    <form className="collections-create" onSubmit={create}><label htmlFor="collection-name">Create a collection</label><div className="collections-create-row"><input id="collection-name" maxLength={180} value={name} onChange={event => setName(event.target.value)} placeholder="Name of the collection"/><button className="btn secondary" disabled={!name.trim()}>Create</button></div></form>
    {selected && <div className="collection-management"><button type="button" className="access-inline-action collection-delete" onClick={() => void deleteCollection()}>Remove collection</button></div>}
    {inline && story && <button type="button" className="access-inline-action personal-cancel" onClick={close}>Cancel story selection</button>}
  </>;
  if (inline) return <section className="dialog collections-dialog personal-content" aria-labelledby="favorites-title">{content}</section>;
  return <div className="modal-backdrop" onMouseDown={close}><section className="dialog collections-dialog" role="dialog" aria-modal="true" aria-labelledby="favorites-title" onMouseDown={event => event.stopPropagation()}>{content}</section></div>;
}

type BookRendition = { prev: () => void; next: () => void; destroy: () => void; themes: { override: (name: string, value: string, priority?: boolean) => void } };

function applyBookAppearance(rendition: BookRendition, element: HTMLElement, appearance: Appearance) {
  const colors = getComputedStyle(element);
  const dark = appearance === 'night';
  rendition.themes.override('color', dark ? colors.getPropertyValue('--color-ink').trim() : '', dark);
  rendition.themes.override('background-color', dark ? colors.getPropertyValue('--color-surface').trim() : '', dark);
}

function Reader({ file, appearance, setAppearance, close }: { file: FileItem; appearance: Appearance; setAppearance: (appearance: Appearance) => void; close: () => void }) {
  const [readingSettings, setReadingSettings] = useState<{ fontSize: number; fontFamily: string; lineHeight: string; background: string }>({ fontSize: 100, fontFamily: 'serif', lineHeight: '1.6', background: 'light' });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [positionLoaded, setPositionLoaded] = useState(false);
  const [positionError, setPositionError] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [translated, setTranslated] = useState<TranslationWindow | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translatedPosition, setTranslatedPosition] = useState(0);
  const [translatedJob, setTranslatedJob] = useState('');
  const [translationSaveError, setTranslationSaveError] = useState('');
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const rendition = useRef<BookRendition | null>(null);
  const positionLoadedFor = useRef<string | null>(null);
  const positionWriter = useRef<ReturnType<typeof createDeferredProgressWriter<{ storyId: string; location: string }>> | null>(null);
  const updateLocation = useCallback((next: string) => {
    setLocation(next);
    if (next && positionLoadedFor.current === file.id) positionWriter.current?.schedule({ storyId: file.id, location: next });
  }, [file.id]);
  useEffect(() => {
    const writer = createDeferredProgressWriter<{ storyId: string; location: string }>(async ({ storyId, location }) => {
      const response = await fetch(`/api/reading/${encodeURIComponent(storyId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location }), keepalive: true, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Could not save position');
      if (positionLoadedFor.current === storyId) setPositionError('');
    }, (_error, value) => { if (positionLoadedFor.current === value.storyId) setPositionError("Could not save your progress. Check your connection."); });
    positionWriter.current = writer;
    const flush = () => { trackClosingProgress(file.id, writer.flush()); };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); if (positionWriter.current === writer) positionWriter.current = null; flush(); };
  }, [file.id]);
  function moveTranslated(delta: number) {
    const next = delta < 0 ? translated?.previousPosition : translated?.nextPosition;
    if (!translatedJob || next == null || translated?.segment?.position !== translatedPosition) return;
    setTranslatedPosition(next); setTranslationSaveError('');
    const jobId = translatedJob;
    void queueTranslationProgress(jobId, async () => {
      const response = await fetch(`/api/translations/${jobId}/position`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: next }), keepalive: true, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Could not save position');
    }).catch(() => { setTranslationSaveError("Could not save translation progress."); });
  }
  useEffect(() => {
    let cancelled = false;
    positionLoadedFor.current = null;
    void waitForClosingProgress(file.id).then(() => {
      if (cancelled) throw new Error('Reader closed');
      return fetch(`/api/reading/${file.id}`, { signal: AbortSignal.timeout(15000) });
    }).then(async res => {
      if (!res.ok) throw new Error('Position unavailable');
      const data = await res.json() as { location?: unknown };
      if (data.location !== null && typeof data.location !== 'string') throw new Error('Invalid position');
      return data.location;
    }).then(saved => { if (!cancelled) { positionLoadedFor.current = file.id; const initial = saved || (file.type === 'pdf' ? 'pdf:1' : ''); setLocation(initial); if (!saved && initial) positionWriter.current?.schedule({ storyId: file.id, location: initial }); setPositionLoaded(true); } }).catch(() => { if (!cancelled) { setLocation(file.type === 'pdf' ? 'pdf:1' : ''); setPositionError("Could not restore your progress. You can read, but reopen the file to save your position."); setPositionLoaded(true); } });
    return () => { cancelled = true; if (positionLoadedFor.current === file.id) positionLoadedFor.current = null; };
  }, [file.id, file.type]);
  const settingsRef = useRef(readingSettings);
  const setAppearanceRef = useRef(setAppearance);
  useEffect(() => { setAppearanceRef.current = setAppearance; }, [setAppearance]);
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/reading/settings').then(async res => res.ok ? res.json() as Promise<{ settings: typeof readingSettings }> : null).then(data => {
      if (!cancelled && data) { setReadingSettings(data.settings); setAppearanceRef.current(data.settings.background === 'night' ? 'night' : data.settings.background === 'warm' ? 'warm' : 'blue'); setSettingsLoaded(true); }
    }).catch(() => { if (!cancelled) setSettingsLoaded(true); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    settingsRef.current = readingSettings;
    if (rendition.current) {
      rendition.current.themes.override('font-size', `${readingSettings.fontSize}%`, true);
      rendition.current.themes.override('font-family', readingSettings.fontFamily, true);
      rendition.current.themes.override('line-height', readingSettings.lineHeight, true);
    }
    if (!settingsLoaded) return;
    const timer = window.setTimeout(() => { void fetch('/api/reading/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(readingSettings) }); }, 500);
    return () => window.clearTimeout(timer);
  }, [readingSettings, settingsLoaded]);
  const appearanceRef = useRef(appearance);
  useEffect(() => {
    appearanceRef.current = appearance;
    if (rendition.current && container.current) applyBookAppearance(rendition.current, container.current, appearance);
  }, [appearance]);
  useEffect(() => {
    if (file.type !== 'epub' || !container.current || !positionLoaded) return;
    let cancelled = false;
    let book: { destroy: () => void } | null = null;
    (async () => {
      try {
        const { default: ePub } = await import('epubjs');
        const response = await fetch(`/api/catalog/stories/${file.id}/file`);
        if (!response.ok) throw Error('Could not open the file.');
        const bytes = await response.arrayBuffer();
        if (cancelled) return;
        const opened = ePub(bytes); book = opened;
        opened.spine.hooks.content.register((document: Document) => sanitizeEpubDocument(document));
        const display = opened.renderTo(container.current!, { width: '100%', height: '100%', spread: 'none', allowScriptedContent: false });
        rendition.current = display;
        display.hooks.content.register((contents: { document: Document }) => protectReaderDocument(contents.document));
        applyBookAppearance(display, container.current!, appearanceRef.current);
        display.themes.override('font-size', `${settingsRef.current.fontSize}%`, true);
        display.themes.override('font-family', settingsRef.current.fontFamily, true);
        display.themes.override('line-height', settingsRef.current.lineHeight, true);
        display.on('relocated', (position: { start?: { cfi?: string } }) => { if (position.start?.cfi) updateLocation(`epub:${position.start.cfi}`); });
        await display.display(location.startsWith('epub:') ? location.slice(5) : undefined);
      } catch { if (!cancelled) setError('Could not open this EPUB. It may be damaged or protected.'); }
    })();
    return () => { cancelled = true; rendition.current?.destroy(); rendition.current = null; book?.destroy(); };
  }, [file, positionLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="reader"><header className="reader-bar"><button className="back-btn" aria-label="Back to library" onClick={close}><ArrowLeft size={19}/><span>Back to library</span></button><div className="reader-title"><span className={`reader-type ${file.type}`}>{file.type.toUpperCase()}</span><strong>{file.name}</strong></div><button className="workspace-mode-toggle reader-mode-toggle" type="button" aria-label={appearance === 'night' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => { const next = appearance === 'night' ? 'light' : 'night'; setReadingSettings(old => ({ ...old, background: next })); setAppearance(next === 'night' ? 'night' : 'blue'); }}>{appearance === 'night' ? <Sun size={17}/> : <Moon size={17}/>}<span>{appearance === 'night' ? 'Light mode' : 'Dark mode'}</span></button><button type="button" className="btn secondary" onClick={() => setSettingsOpen(true)}>Reading</button><button type="button" className="btn secondary" onClick={() => setNotesOpen(true)}>Notes and bookmarks</button></header><div className="reader-body"><div className="reading-area"><div className="reader-controls"><button type="button" onClick={() => setShowTranslated(false)} aria-pressed={!showTranslated}>Original</button><button type="button" onClick={() => setShowTranslated(true)} aria-pressed={showTranslated} disabled={!translated?.segment}>Translation</button></div>{positionError && <p role="alert">{positionError}</p>}<div className="reader-original" hidden={showTranslated}>{file.type === 'pdf' ? (positionLoaded && <PdfReader file={file} zoom={readingSettings.fontSize} page={Math.max(1, Number(location.startsWith('pdf:') ? location.slice(4) : 1) || 1)} setPage={page => updateLocation(`pdf:${page}`)}/>) : <><div className="epub-view" ref={container}/>{error && <p className="reader-error">{error}</p>}<div className="reader-controls"><button onClick={() => rendition.current?.prev()} aria-label="Previous page"><ChevronLeft size={20}/></button><span>Use the arrows to read</span><button onClick={() => rendition.current?.next()} aria-label="Next page"><ChevronRight size={20}/></button></div></>}</div>{showTranslated && <div className="pdf-scroll translated-text"><p>Automatic translation</p><p className="protected-reading-text" onCopy={event => event.preventDefault()} onCut={event => event.preventDefault()} onContextMenu={event => event.preventDefault()} onDragStart={event => event.preventDefault()} style={{ whiteSpace: 'pre-wrap', fontSize: `${readingSettings.fontSize}%`, fontFamily: readingSettings.fontFamily, lineHeight: readingSettings.lineHeight }}>{translated?.segment?.position === translatedPosition ? translated.segment.translatedText || "This segment is still being translated." : 'Loading segment…'}</p><div className="reader-controls"><button type="button" disabled={translated?.segment?.position !== translatedPosition || translated.previousPosition == null} onClick={() => moveTranslated(-1)} aria-label="Previous segment"><ChevronLeft size={20}/></button><span>{translatedPosition + 1} / {translated?.total ?? 0}</span><button type="button" disabled={translated?.segment?.position !== translatedPosition || translated.nextPosition == null} onClick={() => moveTranslated(1)} aria-label="Next segment"><ChevronRight size={20}/></button></div>{translationSaveError && <p role="alert">{translationSaveError}</p>}</div>}</div><TranslationPanel file={file} position={translatedPosition} onWindow={value => { setTranslated(value); if (!value) setShowTranslated(false); }} onJobReady={(id, position) => { setTranslatedJob(id); setTranslatedPosition(position); setTranslationSaveError(''); }}/></div>{settingsOpen && <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="reading-settings-title" onMouseDown={event => event.stopPropagation()}><h2 id="reading-settings-title">Reading preferences</h2><label htmlFor="reading-size">Size: {readingSettings.fontSize}%</label><input id="reading-size" type="range" min="70" max="200" step="10" value={readingSettings.fontSize} onChange={event => setReadingSettings(old => ({ ...old, fontSize: Number(event.target.value) }))}/><label htmlFor="reading-font">Font</label><select id="reading-font" value={readingSettings.fontFamily} onChange={event => setReadingSettings(old => ({ ...old, fontFamily: event.target.value }))}><option value="serif">Serif</option><option value="sans-serif">Sans serif</option><option value="monospace">Monospace</option></select><label htmlFor="reading-spacing">Spacing</label><select id="reading-spacing" value={readingSettings.lineHeight} onChange={event => setReadingSettings(old => ({ ...old, lineHeight: event.target.value }))}><option value="1.3">Compact</option><option value="1.6">Comfortable</option><option value="2">Wide</option></select><label htmlFor="reading-background">Background</label><select id="reading-background" value={readingSettings.background} onChange={event => { const value = event.target.value; setReadingSettings(old => ({ ...old, background: value })); setAppearance(value === 'night' ? 'night' : value === 'warm' ? 'warm' : 'blue'); }}><option value="light">Light</option><option value="warm">Warm</option><option value="night">Dark</option></select><p>For fixed-layout PDFs, size controls zoom.</p><button type="button" className="btn secondary" onClick={() => setSettingsOpen(false)}>Close</button></section></div>}{notesOpen && <ReadingNotes storyId={file.id} location={location || 'inicio'} close={() => setNotesOpen(false)} jump={next => { if (file.type === 'epub' && next.startsWith('epub:')) { void (rendition.current as BookRendition & { display: (target: string) => Promise<unknown> } | null)?.display(next.slice(5)); } else updateLocation(next); setNotesOpen(false); }}/>}</div>;
}

function PdfReader({ file, page, setPage, zoom }: { file: FileItem; page: number; setPage: (page: number) => void; zoom: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (doc && page > doc.numPages) setPage(doc.numPages);
  }, [doc, page, setPage]);
  useEffect(() => {
    let cancelled = false;
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | null = null;
    (async () => { try { const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'; if (cancelled) return; task = pdfjs.getDocument({ url: `/api/catalog/stories/${encodeURIComponent(file.id)}/file`, disableStream: true, disableAutoFetch: true }); const loaded = await task.promise; if (!cancelled) setDoc(loaded); } catch { if (!cancelled) setError('Could not open this PDF. It may be damaged or protected.'); } })();
    return () => { cancelled = true; void task?.destroy(); };
  }, [file.id]);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let cancelled = false;
    let renderTask: import('pdfjs-dist').RenderTask | null = null;
    (async () => { try { const current = await doc.getPage(page); if (cancelled || !canvas.current) return; const viewport = current.getViewport({ scale: 1 }); const available = canvas.current.parentElement?.clientWidth || 700; const scale = Math.min(3, Math.max(.5, (available - 40) / viewport.width * zoom / 100)); const scaled = current.getViewport({ scale }); const target = canvas.current; target.style.maxWidth = zoom > 100 ? 'none' : '100%'; target.width = scaled.width; target.height = scaled.height; const context = target.getContext('2d'); if (!context) return; renderTask = current.render({ canvasContext: context, viewport: scaled, canvas: target }); await renderTask.promise; if (!cancelled) setError(''); } catch { if (!cancelled) setError('Could not display this page.'); } })();
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [doc, page, zoom]);

  return <><div className="pdf-scroll"><canvas ref={canvas} aria-label={`Page ${page} of ${file.name}`} hidden={!!error} onContextMenu={event => event.preventDefault()} onDragStart={event => event.preventDefault()}/>{error && <p className="reader-error" role="alert">{error}</p>}</div><div className="reader-controls"><button onClick={() => setPage(Math.max(1, page - 1))} disabled={!doc || page <= 1} aria-label="Previous page"><ChevronLeft size={20}/></button><span>{doc ? `Page ${page} of ${doc.numPages}` : error ? 'PDF unavailable' : 'Opening PDF…'}</span><button onClick={() => setPage(Math.min(doc?.numPages || 1, page + 1))} disabled={!doc || page >= doc.numPages} aria-label="Next page"><ChevronRight size={20}/></button></div></>;
}
