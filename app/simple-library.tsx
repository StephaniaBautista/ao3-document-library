'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, BookOpen, Bookmark, ChevronDown, ChevronLeft, ChevronRight, Download, Folder, Heart, Library, LogOut, MessageSquare, Moon, MoreHorizontal, Palette, Search, Sun, Upload, WifiOff, X } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { extractMetadata } from '@/lib/catalog/extract-metadata';
import { displaySummary, parseAo3Header } from '@/lib/catalog/metadata.mjs';
import { prepareImport, type ImportItem, type ImportPlan } from '@/lib/catalog/import-archive';
import { readableDomText } from '@/lib/catalog/dom-text';
import { useModalAccessibility } from '@/lib/use-modal-accessibility';
import { useLibraryPreferences, type ColorPalette } from '@/lib/library-preferences';
import { ContinueReading, FavoritesDialog, ReadingNotes, ReminderDialog, RemovalDialog, RemovalRequests, TrackerDialog, type FileItem } from './library';
import NotificationIssues from './notification-issues';
import DeleteAccount from './delete-account';
import { ReaderSettingsPanel, useReaderSettings, type ReaderFont } from './reader-settings';
import { OfflineSaveDialog } from './offline-save';
import { AnchoredText, type Chapter, type ChapterJump, type TextAnchor } from './anchored-text';
import LocalLibrary from './local-library';
import DriveImport from './drive-import';
import { createDeferredProgressWriter, trackClosingProgress, waitForClosingProgress } from '@/lib/catalog/deferred-progress.mjs';

type Role = 'admin' | 'moderator' | 'user';
type User = { id: string; name: string; email: string; role: Role };
type FolderItem = { id: string; parentId: string | null; name: string };
type Story = { id: string; folderId: string | null; filename: string; fileType: 'pdf' | 'epub' | 'html'; title: string; author: string | null; summary: string | null; fandom: string | null; relationship: string | null; warnings: string | null; rating: string | null; language: string | null; category: string | null; characters: string | null; tags: string | null; wordCount: number | null; chapterCount: number | null; totalChapters: number | null; ao3Url?: string | null };
type Page = { text: string; page: number; total: number; chapters?: Chapter[]; anchors?: TextAnchor[]; language: string | null; layout?: { width: number; height: number; spans: PdfTextSpan[] } | null };
type AdminUser = { id: string; name: string; email: string; role: string; blocked: number };
type ImportProgress = { phase: string; name: string; completed: number; total: number; added: number; duplicates: number; errors: number };
const STORIES_PER_PAGE = 20, FANDOMS_PER_PAGE = 5;
const COLOR_PALETTES: { value: ColorPalette; label: string }[] = [
 { value: 'original', label: 'Terracotta' }, { value: 'ocean', label: "Ocean" },
 { value: 'forest', label: 'Forest' }, { value: 'lavender', label: 'Lavender' },
 { value: 'rose', label: 'Rose' }, { value: 'slate', label: 'Slate' },
];
type ImportOptions = { mixed: boolean; fandom: string; pairing: string };
type RetryBatch = { plan: ImportPlan; items: ImportItem[]; skipped: string[]; options: ImportOptions }; 

function StoryTagGroup({ label, value, kind }: { label: string; value: string | null; kind: string }) {
 if (!value?.trim()) return null;
 const items = value.split(/,(?![^()]*\))/).map(item => item.trim()).filter(Boolean);
 return <span className="folio-card-group"><span className="folio-card-label">{label}</span><span className={`folio-card-chips folio-card-${kind}`}>{items.map((item, index) => <span key={index}>{item}</span>)}</span></span>;
}
function StoryCard({ story, open, actionLabel = 'View story' }: { story: Story; open: () => void; actionLabel?: string }) {
 return <button type="button" className="folio-story" onClick={open}>
  <span className="folio-card-header"><span className="folio-card-rating">Rating: {story.rating || "Unrated"}</span><span className="folio-story-title">{story.title || story.filename}</span><span className="folio-story-byline">{story.author ? `by ${story.author}` : "Author unknown"}</span></span>
  <span className="folio-card-group"><span className="folio-card-label">Fandom</span><span className="folio-card-fandom">{story.fandom || 'No fandom specified'}</span></span>
  <span className="folio-card-group"><span className="folio-card-label">Summary</span><span className="folio-card-summary">{displaySummary(story.summary, story.fileType === 'pdf') || 'No summary was found in this file.'}</span></span>
  <StoryTagGroup label="Relationships" value={story.relationship} kind="relationships"/>
  <StoryTagGroup label="Warnings" value={story.warnings} kind="warnings"/>
  <StoryTagGroup label="Category" value={story.category} kind="tags"/>
  <StoryTagGroup label="Characters" value={story.characters} kind="characters"/>
  <StoryTagGroup label="Tags" value={story.tags} kind="tags"/>
  <span className="folio-card-footer">{story.wordCount != null && <span>{story.wordCount.toLocaleString()} words</span>}{story.chapterCount != null && <span>Ch. {story.chapterCount}{story.totalChapters != null ? `/${story.totalChapters}` : ''}</span>}<span>{story.fileType.toUpperCase()}</span><span className="folio-card-open">{actionLabel} <ArrowRight size={15}/></span></span>
 </button>;
}

function toPersonalStory(story: Story): FileItem {
 // The existing personal tools use only metadata and IDs, never the original file.
 return { ...story, name: story.filename, type: story.fileType as FileItem['type'], size: 0, createdAt: 0 };
}

function ReaderActions({ customize, notes, remind, story, userId }: { customize: () => void; notes: () => void; remind: (action: 'kudo' | 'comment') => void; story: Story; userId: string }) {
 const menu = useRef<HTMLDetailsElement>(null);
 const [offlineOpen, setOfflineOpen] = useState(false);
 useEffect(() => {
  function dismiss(event: PointerEvent) { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; }
  function escape(event: KeyboardEvent) { if (event.key === 'Escape' && menu.current?.open) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); } }
  document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
  return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
 }, []);
 function choose(action: () => void) { if (menu.current) menu.current.open = false; action(); }
 return <><div className="folio-reader-actions"><button type="button" className="folio-reader-type" aria-label="Customize reading" title="Customize reading" onClick={customize}>Aa</button><details className="reader-more" ref={menu}><summary aria-label="More reading options" title="More reading options"><MoreHorizontal size={20}/></summary><div className="reader-more-menu"><span>IN THIS STORY</span><button type="button" onClick={() => choose(() => setOfflineOpen(true))}><Download size={17}/>Save offline</button><button type="button" onClick={() => choose(notes)}><Bookmark size={17}/>Notes and bookmarks</button><button type="button" onClick={() => choose(() => remind('kudo'))}><Heart size={17}/>Kudo for later</button><button type="button" onClick={() => choose(() => remind('comment'))}><MessageSquare size={17}/>Comment for later</button></div></details></div>{offlineOpen && <OfflineSaveDialog story={story} userId={userId} close={() => setOfflineOpen(false)}/>}</>;
}

function fromPersonalStory(story: FileItem): Story {
 return { ...story, filename: story.name, fileType: story.type, author: story.author || null, summary: story.summary || null, fandom: story.fandom || null, relationship: story.relationship || null, warnings: story.warnings || null, rating: story.rating || null, language: story.language || null, category: story.category || null, characters: story.characters || null, tags: story.tags || null, wordCount: story.wordCount ?? null, chapterCount: story.chapterCount ?? null, totalChapters: story.totalChapters ?? null };
}

async function json<T = { error?: string }>(response: Response): Promise<T> {
 const data = await response.json() as T & { error?: string };
 if (!response.ok) throw new Error(data.error || "Could not complete the operation.");
 return data;
}
function cleanHtmlMetadata(text: string) {
 const doc = new DOMParser().parseFromString(text, 'text/html');
 doc.querySelectorAll('script,style,iframe,object,embed,noscript').forEach(node => node.remove());
 const blockText = readableDomText(doc.body).slice(0, 60000);
 const parsed = parseAo3Header(blockText);
 return { ...parsed, title: parsed.title || doc.title || undefined };
}

export default function SimpleLibrary({ user }: { user: User }) {
 useModalAccessibility();
 useEffect(() => { if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/offline-worker.js').catch(() => {}); }, []);
 const [folders, setFolders] = useState<FolderItem[]>([]), [stories, setStories] = useState<Story[]>([]);
 const [folder, setFolder] = useState<string | null>(null), [query, setQuery] = useState('');
 const [fandomQuery, setFandomQuery] = useState(''), [fandomOpen, setFandomOpen] = useState(false), [storyLoading, setStoryLoading] = useState(true);
 const [fandomPage, setFandomPage] = useState(1), [storyPage, setStoryPage] = useState(1);
 const [ratingFilter, setRatingFilter] = useState(''), [categoryFilter, setCategoryFilter] = useState(''), [statusFilter, setStatusFilter] = useState('');
 const [relationshipFilter, setRelationshipFilter] = useState(''), [characterFilter, setCharacterFilter] = useState(''), [includeTags, setIncludeTags] = useState(''), [excludeTags, setExcludeTags] = useState('');
 const storiesSection = useRef<HTMLElement>(null);
 const [hasMore, setHasMore] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
 const [selected, setSelected] = useState<Story | null>(null), [reading, setReading] = useState<Story | null>(null);
 const [files, setFiles] = useState<File[] | null>(null), [mixed, setMixed] = useState(true), [fandom, setFandom] = useState(''), [pairing, setPairing] = useState('');
 const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
 const [importFailures, setImportFailures] = useState<string[]>([]);
 const [retryCount, setRetryCount] = useState(0), [retrying, setRetrying] = useState(false);
 const retryBatch = useRef<RetryBatch | null>(null), activeImport = useRef<ImportPlan | null>(null), importing = useRef(false);
 useEffect(() => () => { const plan = activeImport.current || retryBatch.current?.plan; if (plan) void plan.close().catch(() => {}); }, []);
 const [newFolder, setNewFolder] = useState(false), [newFolderName, setNewFolderName] = useState(''), [folderError, setFolderError] = useState('');
 const [usersOpen, setUsersOpen] = useState(false), [driveOpen, setDriveOpen] = useState(false);
 const { preferences, updatePreferences } = useLibraryPreferences(user.id);
 const dark = preferences.appearance === 'night';
 useEffect(() => {
  try { localStorage.setItem('biblioteca-offline-appearance', JSON.stringify({ appearance: preferences.appearance, colorPalette: preferences.colorPalette })); }
  catch { /* The library remains usable when browser storage is unavailable. */ }
 }, [preferences.appearance, preferences.colorPalette]);
 function setDark(next: boolean) { if (next !== dark) updatePreferences({ appearance: next ? 'night' : preferences.lightAppearance }); }
 const [view, setView] = useState<'catalog' | 'personal' | 'ao3'>('catalog'), [personalTab, setPersonalTab] = useState<'collections' | 'reading' | 'local'>('collections'), [favoriteStory, setFavoriteStory] = useState<FileItem | null>(null);
 useEffect(() => { const hash = window.location.hash; if (hash === '#mi-biblioteca' || hash === '#estado-ao3') queueMicrotask(() => setView(hash === '#mi-biblioteca' ? 'personal' : 'ao3')); }, []);
 useEffect(() => { if (sessionStorage.getItem('biblioteca-private-drive-return') === '1') { sessionStorage.removeItem('biblioteca-private-drive-return'); sessionStorage.setItem('biblioteca-private-drive-open', '1'); queueMicrotask(() => { setView('personal'); setPersonalTab('local'); }); } }, []);
 const [reminderStory, setReminderStory] = useState<FileItem | null>(null);
 const [removalStory, setRemovalStory] = useState<FileItem | null>(null), [requestsOpen, setRequestsOpen] = useState(false), [issuesOpen, setIssuesOpen] = useState(false), [deleteAccount, setDeleteAccount] = useState(false);
 const input = useRef<HTMLInputElement>(null);
 const account = useRef<HTMLDetailsElement>(null);
 useEffect(() => {
  if (window.location.hash === '#account' && account.current) account.current.open = true;
  if (window.location.hash === '#upload') queueMicrotask(() => setNotice('Choose Upload files to select stories.'));
 }, []);
 const loadSequence = useRef(0);
 async function load() {
  const sequence = ++loadSequence.current;
  setBusy(true);
  try {
   const params = new URLSearchParams({ sort: 'recent', limit: String(STORIES_PER_PAGE), offset: String((storyPage - 1) * STORIES_PER_PAGE) }); if (folder) params.set('folder', folder); else params.set('all', '1'); if (query.trim()) params.set('q', query.trim()); if (ratingFilter) params.set('rating', ratingFilter); if (categoryFilter) params.set('category', categoryFilter); if (statusFilter) params.set('status', statusFilter); if (relationshipFilter.trim()) params.set('relationship', relationshipFilter.trim()); if (characterFilter.trim()) params.set('characters', characterFilter.trim()); for (const tag of includeTags.split('\n').map(value => value.trim()).filter(Boolean)) params.append('include', tag); for (const tag of excludeTags.split('\n').map(value => value.trim()).filter(Boolean)) params.append('exclude', tag);
   const [f, s] = await Promise.all([fetch('/api/catalog/folders').then(response => json<{ folders: FolderItem[] }>(response)), fetch(`/api/catalog/stories?${params}`).then(response => json<{ stories: Story[]; hasMore: boolean }>(response))]);
   if (sequence === loadSequence.current) { setFolders(f.folders); setStories(s.stories); setHasMore(s.hasMore); }
  } catch (error) { if (sequence === loadSequence.current) setNotice(error instanceof Error ? error.message : 'Could not open the library.'); }
  finally { if (sequence === loadSequence.current) { setStoryLoading(false); if (!importing.current) setBusy(false); } }
 }
 useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 150); return () => window.clearTimeout(timer); }, [folder, query, storyPage, ratingFilter, categoryFilter, statusFilter, relationshipFilter, characterFilter, includeTags, excludeTags]); // eslint-disable-line react-hooks/exhaustive-deps
 function chooseFiles(list: FileList | File[]) { const selectedFiles = Array.from(list); if (selectedFiles.length) { setNotice(''); setFiles(selectedFiles); setMixed(true); setFandom(''); setPairing(''); } }
 async function releaseRetry() {
  const previous = retryBatch.current; retryBatch.current = null; setRetryCount(0);
  if (previous) { try { await previous.plan.close(); } catch { /* Nothing was removed from the library. */ } }
 }
 async function runImport(plan: ImportPlan, items: ImportItem[], skipped: string[], options: ImportOptions) {
  activeImport.current = plan;
  let added = 0, duplicates = 0, done = 0;
  const permanentFailures = [...skipped], failures = [...skipped], failedItems: ImportItem[] = [];
  const update = (phase: string, name: string) => setImportProgress({ phase, name, total: items.length, completed: done, added, duplicates, errors: failures.length });
  try {
   for (const item of items) {
    let file: File;
    try { update('Preparing story', item.name); file = await item.read(); }
    catch { const message = `${item.path || item.name}: Could not open the file. Check that it is not damaged or protected.`; failures.push(message); failedItems.push(item); done++; update('Processing stories', item.name); continue; }
    try {
     const extension = file.name.split('.').pop()?.toLowerCase();
     let metadata: ReturnType<typeof parseAo3Header> = {};
     try { metadata = extension === 'html' || extension === 'htm' ? cleanHtmlMetadata(await file.text()) : await extractMetadata(file, extension === 'epub' ? 'epub' : 'pdf'); }
     catch { /* A file can still be imported and reviewed when metadata is missing. */ }
     const form = new FormData(); form.append('file', file);
     for (const [key, value] of Object.entries(metadata)) if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
     if (!metadata.fandom && !options.mixed && options.fandom.trim()) form.set('fandom', options.fandom.trim());
     if (!metadata.relationship && !options.mixed && options.pairing.trim()) form.set('relationship', options.pairing.trim());
     update('Uploading story', item.name);
     const response = await fetch('/api/catalog/stories', { method: 'PUT', body: form });
     if (!response.ok) {
      if (response.status === 413) throw new Error("The file exceeds the server size limit.");
      if (response.status === 401 || response.status === 403) throw new Error("Your session cannot complete the upload. Sign in again.");
      if (response.status === 400 || response.status === 415) throw new Error("The file format is invalid.");
      throw new Error('Could not upload. Please try again.');
     }
     const result = await response.json() as { duplicate?: boolean };
     if (result.duplicate) duplicates++; else added++;
    } catch (error) {
     const message = error instanceof TypeError || error instanceof SyntaxError ? "Could not complete the upload. Check your connection and try again." : error instanceof Error ? error.message : 'Could not upload. Please try again.';
     failures.push(`${item.path || item.name}: ${message}`); failedItems.push(item);
    }
    done++; update('Processing stories', item.name);
   }
   setFiles(null); if (input.current) input.current.value = '';
   const summary = [`${added} ${added === 1 ? 'story added' : 'stories added'}.`];
   if (duplicates) summary.push(`${duplicates} already existed.`);
   if (failures.length) summary.push(`${failures.length} ${failures.length === 1 ? 'file could not be imported' : 'files could not be imported'}.`);
   if (!items.length && !failures.length) summary.push("No compatible files were found.");
   setImportFailures(failures); setNotice(summary.join(' '));
   if (failedItems.length) { retryBatch.current = { plan, items: failedItems, skipped: permanentFailures, options }; setRetryCount(failedItems.length); }
   else { retryBatch.current = null; setRetryCount(0); try { await plan.close(); } catch { /* Ignore cleanup errors. */ } }
   activeImport.current = null;
   setFolder(null); setQuery(''); setStoryPage(1); await load();
  } catch {
   setFiles(null); setNotice("The importation was interrupted. The stories that were already added are still in the library.");
   const pending = [...failedItems, ...items.slice(done)];
   setImportFailures(failures); activeImport.current = null;
   if (pending.length) { retryBatch.current = { plan, items: pending, skipped: permanentFailures, options }; setRetryCount(pending.length); }
   else { retryBatch.current = null; setRetryCount(0); try { await plan.close(); } catch { /* Ignore cleanup errors. */ } }
  }
 }
 async function submitFiles(event: React.FormEvent) {
  event.preventDefault(); if (!files || busy || importing.current) return;
  importing.current = true; setBusy(true); setNotice(''); setImportFailures([]); setRetrying(false);
  await releaseRetry();
  setImportProgress({ phase: 'Checking files', name: '', total: 0, completed: 0, added: 0, duplicates: 0, errors: 0 });
  try {
   const plan = await prepareImport(files, name => setImportProgress({ phase: 'Abriendo ZIP', name, total: 0, completed: 0, added: 0, duplicates: 0, errors: 0 }));
   await runImport(plan, plan.items, plan.skipped, { mixed, fandom, pairing });
  } catch { setFiles(null); setNotice("We couldn't open the selection. Check the files and try again."); }
  finally { importing.current = false; setImportProgress(null); setBusy(false); }
 }
 async function retryFailed() {
  const batch = retryBatch.current; if (!batch || importing.current) return;
  importing.current = true; setBusy(true); setRetrying(true); setFiles([]); setNotice(''); setImportFailures([]);
  setImportProgress({ phase: 'Preparing retry', name: '', total: batch.items.length, completed: 0, added: 0, duplicates: 0, errors: batch.skipped.length });
  try { await runImport(batch.plan, batch.items, batch.skipped, batch.options); }
  finally { importing.current = false; setImportProgress(null); setRetrying(false); setBusy(false); }
 }
 async function move(story: Story, id: string) {
  try { await fetch(`/api/catalog/stories/${story.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: id || null }) }).then(json); setSelected(null); setNotice("Story moved."); await load(); }
  catch (error) { setNotice(error instanceof Error ? error.message : 'Could not move.'); }
 }
 async function createFolder(event: React.FormEvent) {
  event.preventDefault();
  try {
   await fetch('/api/catalog/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newFolderName, parentId: null }) }).then(json);
   setNewFolder(false); setNewFolderName(''); setNotice("Fandom available in the library."); await load();
  } catch (error) { setFolderError(error instanceof Error ? error.message : 'Could not create the fandom.'); }
 }
 const roots = folders.filter(item => item.parentId === null);
 const current = folders.find(item => item.id === folder);
 const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
 const matchingFandoms = roots.filter(item => normalize(item.name).includes(normalize(fandomQuery.trim())));
 const fandomPages = Math.max(1, Math.ceil(matchingFandoms.length / FANDOMS_PER_PAGE));
 const visibleFandomPage = Math.min(fandomPage, fandomPages);
 const visibleFandoms = matchingFandoms.slice((visibleFandomPage - 1) * FANDOMS_PER_PAGE, visibleFandomPage * FANDOMS_PER_PAGE);
 function chooseFandom(id: string | null, showResults = true) {
  if (id !== folder || query || storyPage !== 1) {
   loadSequence.current++; setStoryLoading(true); setStories([]); setHasMore(false);
   setFolder(id); setQuery(''); setStoryPage(1);
  }
  setFandomOpen(false);
  if (showResults) requestAnimationFrame(() => {
   if (window.matchMedia('(max-width: 760px)').matches) storiesSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
   storiesSection.current?.focus({ preventScroll: true });
  });
 }
 function changeStoryQuery(value: string) {
  if (value === query && folder === null) return;
  loadSequence.current++; setStoryLoading(true); setStories([]); setHasMore(false);
  setQuery(value); setFolder(null); setStoryPage(1);
 }
 function changeFilter(setter: (value: string) => void, value: string) {
  loadSequence.current++; setStoryLoading(true); setStories([]); setHasMore(false); setStoryPage(1); setter(value);
 }
 function changeTagFilter(setter: (value: string) => void, value: string) {
  const tags = value.split('\n').map(tag => tag.trim()).filter(Boolean);
  if (tags.length > 10 || tags.some(tag => tag.length > 120)) { setNotice("You can write up to 10 labels per filter, of 120 characters maximum each."); return; }
  changeFilter(setter, value);
 }
 const filtersActive = !!(ratingFilter || categoryFilter || statusFilter || relationshipFilter || characterFilter || includeTags || excludeTags);
 function clearFilters() {
  if (!filtersActive) return;
  loadSequence.current++; setStoryLoading(true); setStories([]); setHasMore(false); setStoryPage(1);
  setRatingFilter(''); setCategoryFilter(''); setStatusFilter(''); setRelationshipFilter(''); setCharacterFilter(''); setIncludeTags(''); setExcludeTags('');
 }
 function changeStoryPage(next: number) {
  if (next < 1 || next === storyPage || storyLoading) return;
  loadSequence.current++; setStoryLoading(true); setStories([]); setHasMore(false); setStoryPage(next);
  storiesSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  storiesSection.current?.focus({ preventScroll: true });
 }
 function storyPagination() {
  if (storyPage === 1 && !hasMore && !storyLoading) return null;
  return <nav className="folio-pagination folio-story-pagination" aria-label="Stories pages"><button className="folio-page-direction" type="button" disabled={storyPage === 1 || storyLoading} onClick={() => changeStoryPage(storyPage - 1)}><ChevronLeft size={16}/> Previous</button><span className="folio-page-numbers">{storyPage > 1 && <button type="button" aria-label={`Go to page ${storyPage - 1}`} disabled={storyLoading} onClick={() => changeStoryPage(storyPage - 1)}>{storyPage - 1}</button>}<span className="folio-page-current" aria-current="page" aria-label={`Current page ${storyPage}`}>{storyPage}</span>{hasMore && <button type="button" aria-label={`Go to page ${storyPage + 1}`} disabled={storyLoading} onClick={() => changeStoryPage(storyPage + 1)}>{storyPage + 1}</button>}</span><button className="folio-page-direction" type="button" disabled={!hasMore || storyLoading} onClick={() => changeStoryPage(storyPage + 1)}>Next <ChevronRight size={16}/></button></nav>;
 }
 function folderPath(item: FolderItem) {
  const segments: string[] = [], visited = new Set<string>();
  let cursor: FolderItem | undefined = item;
  while (cursor && !visited.has(cursor.id)) { visited.add(cursor.id); segments.unshift(cursor.name); cursor = folders.find(parent => parent.id === cursor?.parentId); }
  return segments.join(' / ');
 }
 return <div className="folio-app" data-theme={dark ? 'dark' : 'light'} data-palette={preferences.colorPalette} translate="no">
  <aside className="folio-sidebar" aria-label="Main navigation">
   <nav className="folio-nav" aria-label="Sections">
    <span className="folio-nav-label">EXPLORE</span>
    <button className={view === 'catalog' ? "folio-nav-current" : undefined} aria-current={view === 'catalog' ? "page" : undefined} onClick={() => { setView('catalog'); chooseFandom(null, false); }}><Library size={18}/> Library</button>
    <button className={view === 'personal' ? "folio-nav-current" : undefined} aria-current={view === 'personal' ? "page" : undefined} onClick={() => { setFavoriteStory(null); setView('personal'); }}><Bookmark size={18}/> My library</button>
    <a className="folio-offline-link" href="/offline"><WifiOff size={18}/> Offline</a>
    <button className={view === 'ao3' ? "folio-nav-current" : undefined} aria-current={view === 'ao3' ? "page" : undefined} onClick={() => setView('ao3')}><Activity size={18}/> AO3 status</button>
    {user.role === 'admin' && <button onClick={() => setUsersOpen(true)}><Folder size={18}/> Moderators</button>}
   </nav>
   <div className="folio-sidebar-note"><strong>A place for your stories.</strong><span>Read, save, and share your favorites.</span></div>
  </aside>
  <div className="folio-workspace">
   <header className="folio-top"><div className="folio-location"><span>Library</span><span aria-hidden="true">/</span><strong>{view === 'personal' ? "My library" : view === 'ao3' ? "AO3 status" : current?.name || "Explore"}</strong></div><div className="folio-top-actions"><button className="folio-icon" onClick={() => setDark(!dark)} aria-label={dark ? 'Light mode' : 'Dark mode'}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button><details className="folio-account" ref={account}><summary aria-label="My account" title="My account">{user.name.slice(0, 1).toUpperCase()}</summary><div><strong>{user.name}</strong><small>{user.email}</small><fieldset className="folio-palette-picker"><legend><Palette size={14}/> Colors</legend><div className="folio-palette-options">{COLOR_PALETTES.map(option => <label key={option.value}><input type="radio" name="color-palette" value={option.value} checked={preferences.colorPalette === option.value} onChange={() => updatePreferences({ colorPalette: option.value })}/><span className={`folio-palette-swatch folio-swatch-${option.value}`} aria-hidden="true"/><span>{option.label}</span></label>)}</div><p>It is saved in this browser.</p></fieldset>{user.role !== 'user' && <button onClick={() => setRequestsOpen(true)}>Removal requests</button>}{user.role === 'admin' && <><button onClick={() => setDriveOpen(true)}>Import from Google Drive</button><button onClick={() => setIssuesOpen(true)}>Review notices</button></>}<button onClick={() => setDeleteAccount(true)}>Remove my account</button><button onClick={() => void authClient.signOut().then(() => window.location.reload())}><LogOut size={14}/> Logout</button></div></details><button className="folio-primary" onClick={() => input.current?.click()} disabled={busy}><Upload size={16}/> Upload files</button></div></header>
   <input ref={input} type="file" multiple hidden accept=".zip,.pdf,.epub,.html,.htm,application/zip,application/pdf,application/epub+zip,text/html" onChange={event => { if (event.target.files) chooseFiles(event.target.files); event.target.value = ''; }}/>
   <main className="folio-main">{view === 'catalog' ? <><div className="folio-heading"><div><h1>{current?.name || (query ? "Search results" : 'Explore stories')}</h1><p>{current ? "Stories of this fandom, gathered in one place." : "Find your next reading or share a story."}</p></div></div>
    <label className="folio-search"><Search size={19}/><span className="sr-only">Find Stories</span><input value={query} onChange={event => changeStoryQuery(event.target.value)} placeholder="Search by title, author, fandom, or tag"/></label>
    {notice && <div className="folio-notice" role="status"><div><span>{notice}</span>{retryCount > 0 && <div className="folio-retry"><p>The files that were already saved are in the library.</p><button type="button" className="folio-primary" onClick={() => void retryFailed()} disabled={busy}>Retry {retryCount} {retryCount === 1 ? "file" : "files"}</button><small>Keep this tab open to retry without selecting the ZIP again.</small></div>}{importFailures.length > 0 && <details className="folio-import-errors"><summary>View files that were not imported</summary><ul>{importFailures.map((failure, i) => <li key={i}>{failure}</li>)}</ul></details>}</div><button onClick={() => { setNotice(''); setImportFailures([]); void releaseRetry(); }} aria-label="Close notice"><X size={16}/></button></div>}
    <div className="folio-browser">
     <section className="folio-fandoms" aria-labelledby="fandom-heading">
      <div className="folio-fandom-heading"><div><h2 id="fandom-heading">Explore</h2><p>Find stories by fandom and filters</p></div>{user.role !== 'user' && <button className="folio-link" onClick={() => { setFolderError(''); setNewFolder(true); }}>Create</button>}</div>
      <button className="folio-fandom-toggle" type="button" aria-expanded={fandomOpen} aria-controls="fandom-options" onClick={() => setFandomOpen(!fandomOpen)}><span><small>Filters and fandom</small><strong>{current?.name || 'All fandoms'}</strong></span><ChevronDown size={19}/></button>
      <div id="fandom-options" className={`folio-fandom-content${fandomOpen ? ' is-open' : ''}`}>
       <details className="folio-filter-disclosure"><summary>More filters{filtersActive ? ' · activos' : ''}</summary>
       <div className="folio-filters"><div className="folio-filter-top"><h3 className="folio-filter-title">Filter stories</h3>{filtersActive && <button className="folio-link" type="button" onClick={clearFilters}>Clear</button>}</div><label>Rating<select value={ratingFilter} onChange={event => changeFilter(setRatingFilter, event.target.value)}><option value="">All</option><option value="General Audiences">General public</option><option value="Teen And Up Audiences">Teen and up</option><option value="Mature">Mature</option><option value="Explicit">Explicit</option><option value="__unrated__">No rating</option></select></label><label>Category<select value={categoryFilter} onChange={event => changeFilter(setCategoryFilter, event.target.value)}><option value="">All</option><option value="F/F">F/F</option><option value="M/M">M/M</option><option value="F/M">F/M</option><option value="Gen">General</option><option value="Multi">Multi</option><option value="Other">Other</option></select></label><label>Status<select value={statusFilter} onChange={event => changeFilter(setStatusFilter, event.target.value)}><option value="">All</option><option value="complete">Complete</option><option value="incomplete">In progress</option></select></label><label>Relationship<input value={relationshipFilter} maxLength={120} onChange={event => changeFilter(setRelationshipFilter, event.target.value)} placeholder="Search relationships"/></label><label>Character<input value={characterFilter} maxLength={120} onChange={event => changeFilter(setCharacterFilter, event.target.value)} placeholder="Search character"/></label><label>Include tags<textarea value={includeTags} onChange={event => changeTagFilter(setIncludeTags, event.target.value)} rows={3} placeholder="One per line, up to 10"/></label><label>Exclude tags or warnings<textarea value={excludeTags} onChange={event => changeTagFilter(setExcludeTags, event.target.value)} rows={3} placeholder="One per line, up to 10"/></label><p>Partial matches are used; every included tag must appear and no excluded tag may appear.</p></div>
       </details>
       <h3 className="folio-filter-title">Fandom</h3><label className="folio-fandom-search"><Search size={16}/><span className="sr-only">Search fandom</span><input value={fandomQuery} onChange={event => { setFandomQuery(event.target.value); setFandomPage(1); }} placeholder="Search fandom"/></label>
       <div className="folio-folder-list" aria-label="Fandom list"><button type="button" className={!folder ? 'selected' : ''} aria-pressed={!folder} onClick={() => chooseFandom(null)}><Library size={16}/><span>All fandoms</span></button>{visibleFandoms.map(item => <button type="button" className={folder === item.id ? 'selected' : ''} aria-pressed={folder === item.id} key={item.id} onClick={() => chooseFandom(item.id)}><Folder size={16}/><span>{item.name}</span></button>)}{!matchingFandoms.length && <p className="folio-fandom-empty">{roots.length ? 'No matching fandom found.' : "There are no fandoms yet."}</p>}</div>{fandomPages > 1 && <nav className="folio-pagination folio-fandom-pagination" aria-label="Fandom Pages"><button type="button" aria-label="Previous fandoms" disabled={visibleFandomPage === 1} onClick={() => setFandomPage(visibleFandomPage - 1)}><ChevronLeft size={16}/><span>Previous</span></button><span aria-live="polite">{visibleFandomPage} / {fandomPages}</span><button type="button" aria-label="Next fandoms" disabled={visibleFandomPage === fandomPages} onClick={() => setFandomPage(visibleFandomPage + 1)}><span>Next</span><ChevronRight size={16}/></button></nav>}
      </div>
     </section>
     <section className="folio-stories" ref={storiesSection} tabIndex={-1} aria-labelledby="stories-heading" aria-busy={storyLoading}><div className="folio-section-heading"><div><h2 id="stories-heading">{current ? `Stories in ${current.name}` : query ? "Stories found" : "Recent stories"}</h2><p>{current ? "Showing stories of this fandom." : "Open a story to see its details and start reading."}</p></div>{!storyLoading && <span className="folio-count">{stories.length} {stories.length === 1 ? 'story' : 'stories'} on this page</span>}</div>
     {storyLoading && !stories.length ? <p className="folio-empty" role="status">Loading stories…</p> : stories.length ? <div className="folio-story-grid">{stories.map(story => <StoryCard key={story.id} story={story} open={() => setSelected(story)}/>)}</div> : <div className="folio-empty"><span className="folio-empty-icon"><BookOpen size={25}/></span><h3>{query || filtersActive ? "No stories found" : "There are no stories here yet."}</h3><p>{query || filtersActive ? "Try another search or change the filters." : "Upload a PDF, EPUB, HTML or ZIP to start."}</p>{!query && !filtersActive && <button className="folio-primary" onClick={() => input.current?.click()}>Upload files</button>}</div>}
     {storyPagination()}
     </section>
    </div>
   </> : view === 'ao3' ? <><div className="folio-heading"><div><h1>AO3 status</h1><p>Check the availability of Archive of Our Own and your reminders.</p></div></div><TrackerDialog inline close={() => setView('catalog')}/></> : <>
    <div className="folio-heading"><div><h1>My library</h1><p>Your collections and your progress are private.</p></div></div>
    <div className="personal-tabs" role="tablist" aria-label="My library" onKeyDown={event => {
     if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
     event.preventDefault();
     const tabs = ['collections', 'reading', 'local'] as const; const currentIndex = tabs.indexOf(personalTab); const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[2] : tabs[(currentIndex + (event.key === 'ArrowRight' ? 1 : 2)) % tabs.length];
     setPersonalTab(next);
     document.getElementById(`personal-tab-${next}`)?.focus();
    }}>
     <button id="personal-tab-collections" role="tab" type="button" aria-selected={personalTab === 'collections'} aria-controls="personal-panel-collections" tabIndex={personalTab === 'collections' ? 0 : -1} onClick={() => setPersonalTab('collections')}>My collections</button>
     <button id="personal-tab-reading" role="tab" type="button" aria-selected={personalTab === 'reading'} aria-controls="personal-panel-reading" tabIndex={personalTab === 'reading' ? 0 : -1} onClick={() => setPersonalTab('reading')}>Continue reading</button>
     <button id="personal-tab-local" role="tab" type="button" aria-selected={personalTab === 'local'} aria-controls="personal-panel-local" tabIndex={personalTab === 'local' ? 0 : -1} onClick={() => setPersonalTab('local')}>Local files</button>
    </div>
    <div id="personal-panel-collections" role="tabpanel" aria-labelledby="personal-tab-collections" hidden={personalTab !== 'collections'}>{personalTab === 'collections' && <FavoritesDialog inline story={favoriteStory} close={() => setFavoriteStory(null)} openStory={story => setSelected(fromPersonalStory(story))} renderStory={story => <StoryCard story={fromPersonalStory(story)} open={() => setSelected(fromPersonalStory(story))}/>}/>}</div>
    <div id="personal-panel-reading" role="tabpanel" aria-labelledby="personal-tab-reading" hidden={personalTab !== 'reading'}>{personalTab === 'reading' && <ContinueReading inline close={() => {}} open={story => setReading(fromPersonalStory(story))} renderStory={story => <StoryCard story={fromPersonalStory(story)} open={() => setReading(fromPersonalStory(story))} actionLabel="Continue reading"/>}/>}</div>
    <div id="personal-panel-local" role="tabpanel" aria-labelledby="personal-tab-local" hidden={personalTab !== 'local'}>{personalTab === 'local' && <LocalLibrary userId={user.id} dark={dark} onPublished={() => { void load(); }}/>}</div>
   </>}</main>
  </div>
  {driveOpen && <DriveImport close={() => { setDriveOpen(false); void load(); }}/>}
  {newFolder && <div className="folio-overlay" onMouseDown={() => setNewFolder(false)}><form className="folio-modal" role="dialog" aria-modal="true" aria-labelledby="new-fandom-title" onSubmit={createFolder} onMouseDown={e => e.stopPropagation()}><div className="folio-modal-head"><div><span className="folio-eyebrow">ORGANIZE</span><h2 id="new-fandom-title">Create fandom</h2></div><button type="button" className="folio-icon" onClick={() => setNewFolder(false)} aria-label="Close"><X size={20}/></button></div><label className="folio-fields">Name of fandom<input required autoFocus maxLength={180} value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="e.g. Supergirl"/></label>{folderError && <p role="alert">{folderError}</p>}<div className="folio-modal-actions"><button type="button" className="folio-secondary" onClick={() => setNewFolder(false)}>Cancel</button><button className="folio-primary">Create fandom</button></div></form></div>}
  {files && <div className="folio-overlay" onMouseDown={() => !busy && setFiles(null)}><form className="folio-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onSubmit={submitFiles} onMouseDown={e => e.stopPropagation()}><div className="folio-modal-head"><div><span className="folio-eyebrow">SHARE STORIES</span><h2 id="import-title">Organize upload</h2></div><button type="button" className="folio-icon" onClick={() => setFiles(null)} disabled={busy} aria-label="Close"><X size={20}/></button></div><p>{retrying ? "We try only the pending files again." : `You selected ${files.length} file(s). We will look for the fandom, relationship, and summary in each story.`}</p>{!retrying && <><label className="folio-choice"><input type="checkbox" checked={mixed} onChange={e => setMixed(e.target.checked)}/> The files are mixed or I don&apos;t know what fandom they belong to.</label>{!mixed && <div className="folio-fields"><label>Fandom, if it doesn&apos;t appear in the file<input value={fandom} maxLength={180} onChange={e => setFandom(e.target.value)} placeholder="e.g. Supergirl"/></label><label>Relationship, if not found in the file<input value={pairing} maxLength={300} onChange={e => setPairing(e.target.value)} placeholder="e.g. Kara / Lena"/></label></div>}</>}{importProgress && <div className="folio-import-progress" role="status" aria-live="polite"><div className="folio-import-progress-head"><span className="folio-import-spinner" aria-hidden="true"/><strong>{importProgress.phase}</strong>{importProgress.total > 0 && <span>{importProgress.completed} of {importProgress.total}</span>}</div>{importProgress.name && <p className="folio-import-filename">{importProgress.name}</p>}<progress aria-label="Import progress" {...(importProgress.total > 0 ? { value: importProgress.completed, max: importProgress.total } : {})}/><p>{importProgress.total > 0 ? `${importProgress.added} added · ${importProgress.duplicates} already existed · ${importProgress.errors} failed` : "This may take a few moments in large files."}</p><p>Keep this tab open while importing.</p></div>}<p className="folio-hint">Stories without a detected fandom will remain in the main library for a moderator to organize.</p><div className="folio-modal-actions"><button className="folio-secondary" type="button" onClick={() => setFiles(null)} disabled={busy}>Cancel</button><button className="folio-primary" disabled={busy}>{busy ? 'Processing…' : "Import stories"}</button></div></form></div>}
  {selected && <div className="folio-overlay" onMouseDown={() => setSelected(null)}><section className="folio-modal folio-story-detail" role="dialog" aria-modal="true" aria-labelledby="story-title" onMouseDown={e => e.stopPropagation()}><div className="folio-modal-head"><div><span className="folio-eyebrow">{selected.fandom || 'NO FANDOM'}</span><h2 id="story-title">{selected.title}</h2><p>{selected.author ? `by ${selected.author}` : "Author unknown"}</p></div><button className="folio-icon" onClick={() => setSelected(null)} aria-label="Close"><X size={20}/></button></div><div className="folio-detail-actions"><button className="folio-primary" onClick={() => { setReading(selected); setSelected(null); }}><BookOpen size={17}/> Read story</button><button className="folio-secondary" onClick={() => { setFavoriteStory(toPersonalStory(selected)); setSelected(null); setPersonalTab('collections'); setView('personal'); }}>Save in my library</button></div><h3>Summary</h3><p className="folio-summary">{displaySummary(selected.summary, selected.fileType === 'pdf') || 'No summary was found in this file.'}</p><h3>Details of the story</h3><div className="folio-metadata">{selected.rating && <p><strong>Rating</strong>{selected.rating}</p>}{selected.fandom && <p><strong>Fandom</strong>{selected.fandom}</p>}{selected.relationship && <p><strong>Relationship</strong>{selected.relationship}</p>}{selected.warnings && <p><strong>Warnings</strong>{selected.warnings}</p>}{selected.category && <p><strong>Category</strong>{selected.category}</p>}{selected.characters && <p><strong>Characters</strong>{selected.characters}</p>}{selected.tags && <p><strong>Tags</strong>{selected.tags}</p>}{selected.language && <p><strong>Language</strong>{selected.language}</p>}{selected.wordCount != null && <p><strong>Words</strong>{selected.wordCount.toLocaleString()}</p>}{selected.chapterCount != null && <p><strong>Chapters</strong>{selected.chapterCount}{selected.totalChapters != null ? ` / ${selected.totalChapters}` : null}</p>}</div>{user.role !== 'user' && <label className="folio-move">Move to <select value={selected.folderId || ''} onChange={e => void move(selected, e.target.value)}><option value="">Main Library</option>{folders.map(item => <option key={item.id} value={item.id}>{folderPath(item)}</option>)}</select></label>}<div className="folio-story-actions"><button className="folio-secondary" onClick={() => { setReminderStory(toPersonalStory(selected)); setSelected(null); }}>Remind me to leave kudos or a comment</button><button className="folio-link" onClick={() => { setRemovalStory(toPersonalStory(selected)); setSelected(null); }}>Request removal</button></div></section></div>}
  {reminderStory && <ReminderDialog story={reminderStory} close={() => setReminderStory(null)}/>}
  {removalStory && <RemovalDialog story={removalStory} close={() => setRemovalStory(null)}/>}
  {requestsOpen && <RemovalRequests role={user.role} close={() => setRequestsOpen(false)} onChanged={() => void load()} onOpenStory={(id, title, filename, author) => { setRequestsOpen(false); setReading({ id, title, filename, author, fileType: /\.epub$/i.test(filename) ? 'epub' : /\.html?$/i.test(filename) ? 'html' : 'pdf', folderId: null, summary: null, fandom: null, relationship: null, warnings: null, rating: null, language: null, category: null, characters: null, tags: null, wordCount: null, chapterCount: null, totalChapters: null }); }}/>} 
  {issuesOpen && <NotificationIssues close={() => setIssuesOpen(false)}/>}
  {deleteAccount && <DeleteAccount userId={user.id} close={() => setDeleteAccount(false)}/>}
  {reading && (reading.fileType === 'pdf' ? <PdfHtmlReader userId={user.id} story={reading} dark={dark} palette={preferences.colorPalette} setDark={setDark} close={() => setReading(null)}/> : <HtmlReader userId={user.id} story={reading} dark={dark} palette={preferences.colorPalette} setDark={setDark} close={() => setReading(null)}/>)}
  {usersOpen && <Moderators user={user} close={() => setUsersOpen(false)}/>}
 </div>;
}

function PdfHtmlReader({ userId, story, dark, palette, setDark, close }: { userId: string; story: Story; dark: boolean; palette: ColorPalette; setDark: (value: boolean) => void; close: () => void }) {
 const reader = useReaderSettings(userId); const [settingsOpen, setSettingsOpen] = useState(false);
 const [total, setTotal] = useState<number | null>(null), [firstPage, setFirstPage] = useState<Page | null>(null), [retry, setRetry] = useState(0);
 const [initial, setInitial] = useState<number | null>(null), [index, setIndex] = useState(0);
 const [error, setError] = useState(''), [notice, setNotice] = useState(''), [notesOpen, setNotesOpen] = useState(false);
 const [reminderAction, setReminderAction] = useState<'kudo' | 'comment' | null>(null);
 const scroller = useRef<HTMLDivElement>(null), restored = useRef(false), canSave = useRef(false);
 const writer = useRef<ReturnType<typeof createDeferredProgressWriter<{ storyId: string; location: string }>> | null>(null);
 useEffect(() => {
  let active = true;
  const pending = createDeferredProgressWriter<{ storyId: string; location: string }>(async value => {
   const response = await fetch(`/api/reading/${encodeURIComponent(value.storyId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: value.location }), keepalive: true, signal: AbortSignal.timeout(15000) });
   if (!response.ok) throw new Error('Could not save progress.');
   if (active) setNotice('');
  }, () => { if (active) setNotice("Could not save your progress. Check your connection."); });
  writer.current = pending;
  const flush = () => { trackClosingProgress(story.id, pending.flush()); };
  window.addEventListener('pagehide', flush);
  void waitForClosingProgress(story.id).then(() => fetch(`/api/reading/${encodeURIComponent(story.id)}`)).then(response => json<{ location: string | null }>(response)).then(data => {
   if (!active) return;
   const match = data.location?.match(/^(html|pdf):(\d+)$/);
   const position = match ? Math.max(0, Number(match[2]) - (match[1] === 'pdf' ? 1 : 0)) : 0;
   canSave.current = true; setIndex(position); setInitial(position);
  }).catch(() => { if (active) { setNotice("Could not restore your progress; reopen the story to save your position."); setInitial(0); } });
  return () => { active = false; window.removeEventListener('pagehide', flush); writer.current = null; flush(); };
 }, [story.id]);
 useEffect(() => {
  if (initial === null) return;
  const controller = new AbortController();
  void fetch(`/api/catalog/stories/${encodeURIComponent(story.id)}/reading?page=${initial}`, { signal: controller.signal }).then(response => json<Page>(response)).then(data => {
   if (!controller.signal.aborted) { setTotal(data.total); setFirstPage(data); }
  }).catch(() => { if (!controller.signal.aborted) setError("You couldn't open this story. Check the connection and try again."); });
  return () => controller.abort();
 }, [initial, story.id, retry]);
 useEffect(() => {
  const prevent = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && ['s', 'p'].includes(event.key.toLowerCase())) event.preventDefault(); };
  document.addEventListener('keydown', prevent); return () => document.removeEventListener('keydown', prevent);
 }, []);
 useEffect(() => {
  if (!total || initial === null || !scroller.current || restored.current) return;
  const target = Math.min(initial, total - 1);
  scroller.current.querySelector(`[data-pdf-page="${target}"]`)?.scrollIntoView({ block: 'start' });
  setIndex(target); restored.current = true;
 }, [total, initial]);
 useEffect(() => {
  if (!total || initial === null || !scroller.current) return;
  const root = scroller.current;
  const onScroll = () => {
   if (!restored.current) return;
   const bounds = root.getBoundingClientRect();
   const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-pdf-page]'));
   const current = pages.find(el => el.getBoundingClientRect().bottom > bounds.top + 80);
   if (!current) return;
   const next = Number(current.dataset.pdfPage);
   setIndex(next);
   if (canSave.current) writer.current?.schedule({ storyId: story.id, location: `html:${next}` });
  };
  root.addEventListener('scroll', onScroll, { passive: true }); return () => root.removeEventListener('scroll', onScroll);
 }, [total, initial, story.id]);
 function jump(location: string) {
  const match = location.match(/^(html|pdf):(\d+)$/);
  const target = match ? Number(match[2]) - (match[1] === 'pdf' ? 1 : 0) : -1;
  setNotesOpen(false);
  if (!total || !Number.isSafeInteger(target) || target < 0 || target >= total) { setNotice("Could not locate this bookmark."); return; }
  scroller.current?.querySelector(`[data-pdf-page="${target}"]`)?.scrollIntoView({ block: 'start' });
 }
 const language = (story.language || '').toLowerCase();
 const lang = language === 'english' ? 'en' : language === 'spanish' || language === 'español' ? 'es' : /^[a-z]{2,3}(-[a-z]{2})?$/.test(language) ? language : undefined;
 return <div className="folio-reader" data-theme={dark ? 'dark' : 'light'} data-palette={palette} data-sepia={!dark && reader.settings.sepia ? 'true' : undefined} style={reader.style}><header className="folio-reader-bar" translate="no"><button className="folio-reader-back" onClick={close}><ArrowLeft size={18}/> Library</button><div><strong>{story.title}</strong><small>{story.author}</small></div><ReaderActions customize={() => setSettingsOpen(true)} notes={() => setNotesOpen(true)} remind={setReminderAction} story={story} userId={userId}/><button className="folio-icon" onClick={() => setDark(!dark)} aria-label={dark ? 'Light mode' : 'Dark mode'}>{dark ? <Sun size={19}/> : <Moon size={19}/>}</button></header><div ref={scroller} className="folio-reader-scroll"><div className="folio-pdf-inner" style={{ width: `${reader.settings.size / 19 * 100}%`, maxWidth: `${reader.settings.size / 19 * 820}px` }}><div className="folio-reader-caption" translate="no"><span>READING</span><span>{total ? `${Math.min(index + 1, total)} / ${total}` : ''}</span></div>{notice && <p role="status" className="folio-reader-progress" translate="no">{notice}</p>}{error ? <div role="alert" className="folio-reader-message">{error}<button className="folio-secondary" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry</button></div> : !total || initial === null ? <p className="folio-reader-message">Preparing the reading...</p> : <div lang={lang} translate="yes" onCopy={e => e.preventDefault()} onCut={e => e.preventDefault()} onContextMenu={e => e.preventDefault()} onDragStart={e => e.preventDefault()}>{Array.from({ length: total }, (_, i) => <PdfHtmlPage key={i} number={i + 1} storyId={story.id} root={scroller} initialPage={firstPage?.page === i ? firstPage : null} font={reader.settings.font}/>)}</div>}<p className="folio-reader-tip" translate="no">To translate, use your browser&apos;s translation option.</p></div></div>{settingsOpen && <ReaderSettingsPanel fixedLayout settings={reader.settings} update={reader.update} close={() => setSettingsOpen(false)}/>} {notesOpen && <ReadingNotes storyId={story.id} location={`html:${index}`} close={() => setNotesOpen(false)} jump={jump}/>}{reminderAction && <ReminderDialog story={toPersonalStory(story)} initialAction={reminderAction} close={() => setReminderAction(null)}/>}</div>;
}

type PdfTextSpan = { text: string; left: number; top: number; height: number; width: number; font: string };
function PdfHtmlPage({ number, storyId, root, initialPage, font }: { number: number; storyId: string; root: React.RefObject<HTMLDivElement | null>; initialPage: Page | null; font: ReaderFont }) {
 const ref = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false), [width, setWidth] = useState(0), [retry, setRetry] = useState(0);
 const [content, setContent] = useState<Page | null>(initialPage), [error, setError] = useState('');
 useEffect(() => {
  if (!ref.current || !root.current) return;
  const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { root: root.current, rootMargin: '1000px 0px' });
  observer.observe(ref.current); return () => observer.disconnect();
 }, [root]);
 useEffect(() => {
  if (!ref.current) return;
  const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
  observer.observe(ref.current); return () => observer.disconnect();
 }, []);
 useEffect(() => {
  if (!visible || content) return;
  const controller = new AbortController();
  void fetch(`/api/catalog/stories/${encodeURIComponent(storyId)}/reading?page=${number - 1}`, { signal: controller.signal }).then(response => json<Page>(response)).then(data => {
   if (!controller.signal.aborted) { setContent(data); setError(''); }
  }).catch(() => { if (!controller.signal.aborted) setError("You couldn't load this page."); });
  return () => controller.abort();
 }, [visible, content, number, storyId, retry]);
 const layout = content?.text.trim().length && content.layout?.spans.length ? content.layout : null;
 const scale = layout && width ? width / layout.width : 1;
 return <section ref={ref} data-pdf-page={number - 1} className="folio-pdf-page" aria-label={`Page ${number}`} style={{ aspectRatio: layout ? `${layout.width} / ${layout.height}` : content ? undefined : '0.7727' }}>
  {error ? <div className="folio-pdf-error" role="alert">{error} <button type="button" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry</button></div> : layout ? <PdfPositionedSheet layout={layout} scale={scale} font={font}/> : content && <div className="folio-pdf-ocr">{content.text}</div>}
 </section>;
}
function PdfPositionedSheet({ layout, scale, font }: { layout: { width: number; height: number; spans: PdfTextSpan[] }; scale: number; font: ReaderFont }) {
 const ref = useRef<HTMLDivElement>(null);
 useEffect(() => {
  const sheet = ref.current; if (!sheet) return;
  const originalScales = new WeakMap<HTMLElement, number>();
  const availableWidths = new WeakMap<HTMLElement, number>();
  const measure = document.createElement('canvas').getContext('2d');
  const spansByTop = layout.spans.map((span, index) => ({ span, index })).sort((a, b) => a.span.top - b.span.top);
  const widths = layout.spans.map(span => Math.max(span.width, layout.width * 0.95 - span.left));
  for (let i = 0; i < spansByTop.length; i++) {
   const { span, index } = spansByTop[i];
   for (let j = i + 1; j < spansByTop.length && spansByTop[j].span.top - span.top < span.height * 0.5; j++) {
    const other = spansByTop[j];
    if (Math.abs(other.span.top - span.top) >= Math.min(span.height, other.span.height) * 0.5) continue;
    if (other.span.left >= span.left + span.width - 1) widths[index] = Math.min(widths[index], Math.max(span.width, other.span.left - span.left - 2));
    if (span.left >= other.span.left + other.span.width - 1) widths[other.index] = Math.min(widths[other.index], Math.max(other.span.width, span.left - other.span.left - 2));
   }
  }
  const observer = new ResizeObserver(entries => {
   for (const entry of entries) {
    const element = entry.target as HTMLElement;
    const targetWidth = availableWidths.get(element) ?? Number(element.dataset.pdfWidth);
    if (entry.contentRect.width > 0 && targetWidth > 0) element.style.transform = `scaleX(${Math.min(originalScales.get(element) ?? 1, targetWidth / entry.contentRect.width)})`;
   }
  });
  sheet.querySelectorAll<HTMLElement>('.folio-pdf-span').forEach((element, index) => {
   const targetWidth = Number(element.dataset.pdfWidth);
   if (measure) measure.font = getComputedStyle(element).font;
   const originalWidth = measure?.measureText(layout.spans[index].text).width || element.offsetWidth;
   const originalScale = originalWidth && targetWidth > 0 ? targetWidth / originalWidth : 1;
   const initialScale = element.offsetWidth ? Math.min(originalScale, widths[index] / element.offsetWidth) : originalScale;
   originalScales.set(element, originalScale);
   availableWidths.set(element, widths[index]);
   element.style.transform = `scaleX(${initialScale})`;
   observer.observe(element);
  });
  return () => observer.disconnect();
 }, [layout, font]);
 return <div ref={ref} className="folio-pdf-sheet" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>{layout.spans.map((span, i) => <PdfPositionedText key={i} span={span} font={font}/>)}</div>;
}
function PdfPositionedText({ span, font }: { span: PdfTextSpan; font: ReaderFont }) {
 return <span data-pdf-width={span.width} className="folio-pdf-span" style={{ left: span.left, top: span.top, fontSize: span.height, fontFamily: font !== 'original' ? font : /sans|arial|helvetica/i.test(span.font) ? 'Arial, sans-serif' : 'Georgia, serif', fontWeight: /bold/i.test(span.font) ? 'bold' : 'normal', fontStyle: /italic|oblique/i.test(span.font) ? 'italic' : 'normal' }}>{span.text}</span>;
}

function HtmlReader({ userId, story, dark, palette, setDark, close }: { userId: string; story: Story; dark: boolean; palette: ColorPalette; setDark: (value: boolean) => void; close: () => void }) {
 const reader = useReaderSettings(userId); const [settingsOpen, setSettingsOpen] = useState(false);
 const [index, setIndex] = useState(0), [started, setStarted] = useState(false), [page, setPage] = useState<Page | null>(null), [message, setMessage] = useState('');
 const [notesOpen, setNotesOpen] = useState(false), [progressNotice, setProgressNotice] = useState('');
 const [reminderAction, setReminderAction] = useState<'kudo' | 'comment' | null>(null);
 const [chapterJump, setChapterJump] = useState<ChapterJump | null>(null);
 const chapterRef = useRef<ChapterJump | null>(null);
 function selectChapter(chapter: Chapter) {
  const jump = { page: chapter.page, anchor: chapter.anchor, sequence: (chapterRef.current?.sequence || 0) + 1 };
  chapterRef.current = jump; setChapterJump(jump); legacyEpub.current = false;
  setIndex(chapter.page);
  if (!chapter.anchor) document.querySelector('.folio-reader-scroll')?.scrollTo(0, 0);
  if (canSave.current && chapter.page === index) writer.current?.schedule({ storyId: story.id, location: chapterLocation(jump) });
 }
 function chapterLocation(jump: ChapterJump) {
  try { const result = `html:${jump.page}${jump.anchor ? `#${encodeURIComponent(jump.anchor)}` : ''}`; return result.length <= 1000 ? result : `html:${jump.page}`; }
  catch { return `html:${jump.page}`; }
 }
 const canSave = useRef(false), legacyEpub = useRef(false);
 const writer = useRef<ReturnType<typeof createDeferredProgressWriter<{ storyId: string; location: string }>> | null>(null);
 useEffect(() => {
  let active = true;
  const pending = createDeferredProgressWriter<{ storyId: string; location: string }>(async ({ storyId, location }) => {
   const response = await fetch(`/api/reading/${encodeURIComponent(storyId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location }), keepalive: true, signal: AbortSignal.timeout(15000) });
   if (!response.ok) throw new Error('Could not save progress.');
   if (active) setProgressNotice('');
  }, () => { if (active) setProgressNotice("Could not save your progress. Check your connection."); });
  writer.current = pending;
  const flush = () => { trackClosingProgress(story.id, pending.flush()); };
  window.addEventListener('pagehide', flush);
  return () => { active = false; window.removeEventListener('pagehide', flush); writer.current = null; flush(); };
 }, [story.id]);
 useEffect(() => {
  const preventSaving = (event: KeyboardEvent) => {
   if ((event.ctrlKey || event.metaKey) && ['s', 'p'].includes(event.key.toLowerCase())) event.preventDefault();
  };
  document.addEventListener('keydown', preventSaving);
  return () => document.removeEventListener('keydown', preventSaving);
 }, []);
 useEffect(() => {
  let active = true;
  void waitForClosingProgress(story.id).then(() => fetch(`/api/reading/${encodeURIComponent(story.id)}`)).then(response => json<{ location: string | null }>(response)).then(data => {
   if (!active) return;
   const html = typeof data.location === 'string' ? data.location.match(/^html:(\d+)(?:#(.+))?$/) : null;
   const pdf = typeof data.location === 'string' && story.fileType === 'pdf' ? data.location.match(/^pdf:(\d+)$/) : null;
   if (html) { setIndex(Number(html[1])); if (html[2]) { try { const jump = { page: Number(html[1]), anchor: decodeURIComponent(html[2]), sequence: 1 }; chapterRef.current = jump; setChapterJump(jump); } catch { /* Keep the page if an old anchor is malformed. */ } } }
   else if (pdf) setIndex(Math.max(0, Number(pdf[1]) - 1));
   else if (data.location?.startsWith('epub:')) { legacyEpub.current = true; setProgressNotice("Your previous EPUB position cannot be automatically placed in this reader. It will be preserved until progress."); }
   canSave.current = true;
  }).catch(() => { if (active) setProgressNotice("Could not restore your progress; reopen the story to save your position."); }).finally(() => { if (active) setStarted(true); });
  return () => { active = false; };
 }, [story.id, story.fileType]);
 useEffect(() => {
  if (!started) return;
  const abort = new AbortController();
  fetch(`/api/catalog/stories/${encodeURIComponent(story.id)}/reading?page=${index}`, { signal: abort.signal }).then(response => json<Page>(response)).then(data => {
   if (abort.signal.aborted) return;
   setPage(data); setMessage('');
   if (canSave.current && !legacyEpub.current) writer.current?.schedule({ storyId: story.id, location: chapterRef.current?.page === index ? chapterLocation(chapterRef.current) : `html:${index}` });
  }).catch(error => { if (!abort.signal.aborted) { setPage(null); setMessage(error instanceof Error ? error.message : "Could not open this page."); } });
  return () => abort.abort();
 }, [started, index, story.id]);
 const language = (page?.language || story.language || '').toLowerCase();
 const lang = language === 'english' ? 'en' : language === 'spanish' || language === 'español' ? 'es' : /^[a-z]{2,3}(-[a-z]{2})?$/.test(language) ? language : undefined;
 useEffect(() => {
  const original = document.documentElement.getAttribute('lang');
  if (lang) document.documentElement.setAttribute('lang', lang);
  else document.documentElement.removeAttribute('lang');
  return () => { if (original === null) document.documentElement.removeAttribute('lang'); else document.documentElement.setAttribute('lang', original); };
 }, [lang]);
 const pending = !page || page.page !== index;
 function jumpToNote(location: string) {
  const html = location.match(/^html:(\d+)$/), pdf = story.fileType === 'pdf' ? location.match(/^pdf:(\d+)$/) : null;
  const next = html ? Number(html[1]) : pdf ? Number(pdf[1]) - 1 : -1;
  setNotesOpen(false);
  if (!Number.isSafeInteger(next) || next < 0 || (page && next >= page.total)) { setProgressNotice("This previous reader bookmark cannot be automatically placed in the HTML version."); return; }
  legacyEpub.current = false; chapterRef.current = null; setChapterJump(null); setIndex(next);
 }
 return <div className="folio-reader" data-theme={dark ? 'dark' : 'light'} data-palette={palette} data-sepia={!dark && reader.settings.sepia ? 'true' : undefined} style={reader.style}><header className="folio-reader-bar" translate="no"><button className="folio-reader-back" onClick={close}><ArrowLeft size={18}/> Library</button><div><strong>{story.title}</strong><small>{story.author}</small></div><ReaderActions customize={() => setSettingsOpen(true)} notes={() => setNotesOpen(true)} remind={setReminderAction} story={story} userId={userId}/><button className="folio-icon" onClick={() => setDark(!dark)} aria-label={dark ? 'Light mode' : 'Dark mode'}>{dark ? <Sun size={19}/> : <Moon size={19}/>}</button></header><div className="folio-reader-scroll"><div className="folio-reader-inner"><div className="folio-reader-caption" translate="no"><span>READING</span><span>{page ? `${index + 1} / ${page.total}` : ''}</span></div>{page?.chapters && page.chapters.length > 0 && <label className="reader-chapters" translate="no">Contents <select value="" onChange={event => { if (event.target.value === '') return; const chapter = page.chapters?.[Number(event.target.value)]; if (chapter) selectChapter(chapter); }}><option value="">Choose Chapter</option>{page.chapters.map((chapter, position) => <option key={position} value={position}>{chapter.title}</option>)}</select></label>}{progressNotice && <p className="folio-reader-progress" role="status" translate="no">{progressNotice}</p>}{message ? <div role="alert" className="folio-reader-message">{message}<button className="folio-secondary" onClick={() => { setMessage(''); setStarted(false); setTimeout(() => setStarted(true), 0); }}>Retry</button></div> : pending ? <p className="folio-reader-message">Preparing the reading...</p> : <article key={`${story.id}-${page.page}`} className="folio-reader-text" lang={lang} translate="yes" onCopy={e => e.preventDefault()} onCut={e => e.preventDefault()} onContextMenu={e => e.preventDefault()} onDragStart={e => e.preventDefault()}><AnchoredText text={page.text} anchors={page.anchors} target={chapterJump?.page === index ? chapterJump : null}/></article>}<div className="folio-reader-pagination" translate="no"><button className="folio-secondary" disabled={index <= 0 || pending} onClick={() => { legacyEpub.current = false; chapterRef.current = null; setChapterJump(null); setIndex(index - 1); document.querySelector('.folio-reader-scroll')?.scrollTo(0, 0); }}><ChevronLeft size={16}/> Previous</button><span>{page ? `${index + 1} of ${page.total}` : ''}</span><button className="folio-secondary" disabled={pending || !page || index + 1 >= page.total} onClick={() => { legacyEpub.current = false; chapterRef.current = null; setChapterJump(null); setIndex(index + 1); document.querySelector('.folio-reader-scroll')?.scrollTo(0, 0); }}>Next <ChevronRight size={16}/></button></div><p className="folio-reader-tip" translate="no">To translate, use your browser&apos;s translation option.</p></div></div>{settingsOpen && <ReaderSettingsPanel settings={reader.settings} update={reader.update} close={() => setSettingsOpen(false)}/>} {notesOpen && <ReadingNotes storyId={story.id} location={`html:${index}`} close={() => setNotesOpen(false)} jump={jumpToNote}/>}{reminderAction && <ReminderDialog story={toPersonalStory(story)} initialAction={reminderAction} close={() => setReminderAction(null)}/>}</div>;
}

function Moderators({ user, close }: { user: User; close: () => void }) {
 const [users, setUsers] = useState<AdminUser[]>([]), [search, setSearch] = useState(''), [error, setError] = useState('');
 const [cursor, setCursor] = useState<{ createdAt: number; id: string } | null>(null);
 async function load(append = false) {
  const params = new URLSearchParams({ search });
  if (append && cursor) { params.set('afterTime', String(cursor.createdAt)); params.set('afterId', cursor.id); }
  try { const data = await fetch(`/api/admin/users?${params}`).then(response => json<{ users: AdminUser[]; nextCursor: { createdAt: number; id: string } | null }>(response)); setUsers(old => append ? [...old, ...data.users] : data.users); setCursor(data.nextCursor); }
  catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load accounts.'); }
 }
 useEffect(() => { const timer = setTimeout(() => void load(), 200); return () => clearTimeout(timer); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
 async function update(item: AdminUser, change: { role?: string; blocked?: boolean }) {
  try { await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: item.id, ...change }) }).then(json); await load(); }
  catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the account.'); }
 }
 return <div className="folio-overlay" onMouseDown={close}><section className="folio-modal" role="dialog" aria-modal="true" aria-labelledby="moderators-title" onMouseDown={e => e.stopPropagation()}><div className="folio-modal-head"><div><span className="folio-eyebrow">ADMINISTRATION</span><h2 id="moderators-title">Moderators</h2></div><button className="folio-icon" aria-label="Close" onClick={close}><X size={20}/></button></div><p>Moderators can move stories between folders. They cannot modify their content.</p><label className="folio-fields">Search by name or email<input value={search} onChange={e => setSearch(e.target.value)}/></label>{error && <p role="alert">{error}</p>}<div className="folio-users">{users.map(item => <div key={item.id}><span><strong>{item.name}</strong><small>{item.email}</small></span>{item.id !== user.id && <span><button className="folio-secondary" onClick={() => void update(item, { role: item.role === 'moderator' ? 'user' : 'moderator' })}>{item.role === 'moderator' ? 'Remove moderator' : 'Make moderator'}</button><button className="folio-secondary" onClick={() => void update(item, { blocked: !item.blocked })}>{item.blocked ? 'Unblock' : 'Block'}</button></span>}</div>)}</div>{cursor && <button className="folio-secondary" onClick={() => void load(true)}>Load more accounts</button>}</section></div>;
}
