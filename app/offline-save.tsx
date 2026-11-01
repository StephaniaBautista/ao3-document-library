'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { distributeTranslation, groupLayoutSpans, needsTranslation, splitForTranslation, type OfflineSpan } from '@/lib/catalog/offline-translation.mjs';
import { deleteOfflinePreparation, loadOfflinePreparation, saveOfflinePreparation, type OfflinePreparation } from '@/lib/catalog/offline-preparation';

type OfflineStory = { id: string; title: string; author: string | null; language?: string | null; fileType?: 'pdf' | 'epub' | 'html' };
type OfflinePage = { page: number; total: number; text: string; layout?: { width: number; height: number; spans: OfflineSpan[]; blank?: boolean } | null };
type Preparation = OfflinePreparation<OfflinePage>;

async function fingerprint(page: OfflinePage) {
 const bytes = new TextEncoder().encode(JSON.stringify({ text: page.text, total: page.total, layout: page.layout }));
 const digest = await crypto.subtle.digest('SHA-256', bytes);
 return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function fetchWithRetry(url: string, options: RequestInit & { signal: AbortSignal }) {
 for (let attempt = 0; ; attempt++) {
  try {
   const response = await fetch(url, options);
   if (response.ok || (response.status !== 429 && response.status < 500) || attempt >= 3) return response;
   await response.body?.cancel();
  } catch (error) {
   if (options.signal.aborted || attempt >= 3) throw error;
  }
  await new Promise<void>((resolve, reject) => {
   const onAbort = () => { clearTimeout(timer); reject(new DOMException('Canceled', 'AbortError')); };
   const timer = setTimeout(() => { options.signal.removeEventListener('abort', onAbort); resolve(); }, 500 * 2 ** attempt);
   if (options.signal.aborted) onAbort(); else options.signal.addEventListener('abort', onAbort, { once: true });
  });
 }
}

async function saveCompleteStory(id: string, story: OfflineStory, pages: OfflinePage[], language: 'original' | 'es') {
 const db = await new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('biblioteca-offline-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('stories', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
 });
 try {
  await new Promise<void>((resolve, reject) => {
   const tx = db.transaction('stories', 'readwrite');
   tx.objectStore('stories').put({ id, title: story.title, author: story.author, pages, language, savedAt: Date.now() });
   tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
 } finally { db.close(); }
}

async function translateParts(storyId: string, parts: string[], signal: AbortSignal) {
 const chunks = parts.map(part => splitForTranslation(part));
 const all = chunks.flat(), translated = [...all];
 // Decorative separators and page numbers have no language to translate;
 // some models return an empty result for them, so retain them verbatim.
 const indices = all.map((text, index) => needsTranslation(text) ? index : -1).filter(index => index >= 0);
 for (let start = 0; start < indices.length; start += 32) {
  const batch = indices.slice(start, start + 32), texts = batch.map(index => all[index]);
  const response = await fetchWithRetry(`/api/catalog/stories/${encodeURIComponent(storyId)}/translate-offline`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts }), signal, cache: 'no-store' });
  if (!response.ok) { const error = await response.json().catch(() => null) as { error?: string } | null; throw new Error(error?.error || "Could not complete the translation."); }
  const result = await response.json() as { texts?: unknown };
  if (!Array.isArray(result.texts) || result.texts.length !== texts.length || result.texts.some(text => typeof text !== 'string' || !text.trim())) throw new Error("The translation is incomplete.");
  const values = result.texts as string[];
  batch.forEach((index, position) => { translated[index] = values[position]; });
 }
 let offset = 0;
 return chunks.map(part => { const value = translated.slice(offset, offset + part.length).join(' '); offset += part.length; return value; });
}

async function translatePage(storyId: string, page: OfflinePage, signal: AbortSignal): Promise<OfflinePage> {
 if (page.layout?.spans?.length) {
  const spans = page.layout.spans.map(span => ({ ...span }));
  const groups = groupLayoutSpans(spans); const translated = await translateParts(storyId, groups.map(group => group.text), signal);
  groups.forEach((group, i) => { const lines = distributeTranslation(translated[i], group.indices, spans); group.indices.forEach((index, n) => { spans[index].text = lines[n]; }); });
  return { ...page, text: spans.map(span => span.text).join('\n'), layout: { ...page.layout, spans } };
 }
 const parts = page.text.split(/(\n+)/); const texts = parts.filter(part => part.trim());
 const translated = await translateParts(storyId, texts, signal); let index = 0;
 return { ...page, text: parts.map(part => part.trim() ? translated[index++] : part).join('') };
}

export function OfflineSaveDialog({ story, userId, close }: { story: OfflineStory; userId: string; close: () => void }) {
 const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [language, setLanguage] = useState<'original' | 'es'>('es'), [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
 const [canDiscard, setCanDiscard] = useState(false);
 const controller = useRef<AbortController | null>(null);
 const preparation = useRef<Preparation | null>(null);
 useEffect(() => () => controller.current?.abort(), []);
 async function save() {
  if (busy) return;
  const abort = new AbortController(); controller.current = abort; setBusy(true); setMessage(''); setProgress(null);
  let state: Preparation | null = null;
  try {
   if (language === 'es' && story.language && !/^(en(?:[-_][a-z]+)?|english|ingl[eé]s)$/i.test(story.language.trim())) throw new Error("The local translator currently supports stories written in English.");
   if (!('serviceWorker' in navigator)) throw new Error("This browser does not support offline mode.");
   const registration = await navigator.serviceWorker.register('/offline-worker.js');
   await navigator.serviceWorker.ready;
   if (!registration.active) throw new Error("Could not enable offline mode.");
   const id = `${userId}:${story.id}:${language}:passwordless`;
   let stored: Preparation | undefined;
   try { stored = await loadOfflinePreparation<OfflinePage>(id); }
   catch (error) { setCanDiscard(true); throw error; }
   const valid = stored && Date.now() - stored.updatedAt < 7 * 24 * 60 * 60 * 1000 && Array.isArray(stored.pages) && stored.pages.length > 0 && Number.isSafeInteger(stored.total) && stored.total <= 5000 && stored.pages.length <= stored.total && stored.pages.every((page, index) => page.page === index && page.total === stored.total && typeof page.text === 'string') && Number.isSafeInteger(stored.bytes) && stored.bytes >= 0 && stored.bytes <= 100 * 1024 * 1024 && typeof stored.fingerprint === 'string';
   if (valid && stored) {
    const first = await fetchWithRetry(`/api/catalog/stories/${encodeURIComponent(story.id)}/reading?page=0`, { signal: abort.signal, cache: 'no-store' });
    if (!first.ok) throw new Error("Could not check the story to resume preparation.");
    const firstPage = await first.json() as OfflinePage;
    if (firstPage.page === 0 && firstPage.total === stored.total && await fingerprint(firstPage) === stored.fingerprint) state = stored;
   }
   if (!state && stored) { setCanDiscard(true); throw new Error('The saved preparation cannot be resumed. It remains in this browser.'); }
   if (!state) state = { id, updatedAt: Date.now(), fingerprint: '', pages: [], total: 1, bytes: 0 };
   preparation.current = state;
   if (state.pages.length) { setProgress({ done: state.pages.length, total: state.total }); setMessage("The preparation saved in this browser was resumed."); }
   for (let index = state.pages.length; index < state.total; index++) {
    const response = await fetchWithRetry(`/api/catalog/stories/${encodeURIComponent(story.id)}/reading?page=${index}`, { signal: abort.signal, cache: 'no-store' });
    if (!response.ok) { const detail = await response.json().catch(() => null) as { error?: string } | null; throw new Error(`Could not prepare page ${index + 1}. ${detail?.error || "Check your connection and try again."}`); }
    let page = await response.json() as OfflinePage;
    if (page.page !== index || !Number.isSafeInteger(page.total) || page.total < 1 || page.total > 5000 || (index && page.total !== state.total) || typeof page.text !== 'string') throw new Error("Could not verify that the story is complete.");
    state.total = page.total;
    if (index === 0) state.fingerprint = await fingerprint(page);
    if (language === 'es') {
     if (story.fileType === 'pdf' && !page.layout?.spans?.length && !(page.layout?.blank && !page.text.trim())) throw new Error(`Page ${index + 1} has no text positions. Its layout cannot be preserved in the translation.`);
     page = await translatePage(story.id, page, abort.signal);
    }
    const bytes = new Blob([JSON.stringify(page)]).size;
    if (state.bytes + bytes > 100 * 1024 * 1024) throw new Error('This story is too large to save in this browser.');
    state.bytes += bytes; state.pages.push(page); state.updatedAt = Date.now();
    if (state.pages.length % 5 === 0) await saveOfflinePreparation(state);
    setProgress({ done: index + 1, total: state.total });
   }
   if (abort.signal.aborted) return;
   await saveCompleteStory(`${userId}:${story.id}:${language}:passwordless`, story, state.pages, language);
   await deleteOfflinePreparation(state.id).catch(() => {});
   setCanDiscard(false);
   preparation.current = null;
   setMessage(language === 'es' ? "Complete translation saved. You can read it offline or save it as a PDF." : "Original story saved. You can now read it offline in this browser.");
  } catch (error) {
   if (state?.pages.length && state.fingerprint) await saveOfflinePreparation(state).catch(() => {});
   if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : 'Could not save the story.');
  } finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
 }
 return <div className="folio-overlay" onMouseDown={() => { if (!busy) close(); }}><section className="folio-modal offline-save" role="dialog" aria-modal="true" aria-labelledby="offline-save-title" onMouseDown={event => event.stopPropagation()}><div className="folio-modal-head"><div><span className="folio-eyebrow">ON THIS DEVICE</span><h2 id="offline-save-title">Read offline</h2></div><button className="folio-icon" type="button" aria-label="Close" onClick={() => { controller.current?.abort(); close(); }}><X size={19}/></button></div><p>Save the full story for offline reading. Anyone using this browser profile can read it, even after sign-out.</p><label className="offline-language">Version<select value={language} disabled={busy} onChange={event => { setCanDiscard(false); setLanguage(event.target.value as 'original' | 'es'); }}><option value="es">Spanish translation (from English)</option><option value="original">Original language</option></select></label><p>The translation is automatic. PDF text layout is preserved, but embedded images are not included.</p>{progress && <div className="offline-progress"><progress value={progress.done} max={progress.total}/><span>{language === 'es' ? 'Translating' : 'Preparing'} {progress.done} of {progress.total} pages</span></div>}{message && <p role="status">{message}</p>}{canDiscard && !busy && <button className="folio-secondary" type="button" onClick={() => { if (!window.confirm('Discard the unfinished offline preparation on this device? This cannot be undone.')) return; const id = `${userId}:${story.id}:${language}:passwordless`; void deleteOfflinePreparation(id).then(() => { preparation.current = null; setCanDiscard(false); setMessage('The unfinished preparation was discarded.'); }).catch(() => setMessage('Could not discard the unfinished preparation.')); }}>Discard unfinished preparation</button>}<div className="offline-save-actions">{busy ? <button className="folio-secondary" type="button" onClick={() => { controller.current?.abort(); close(); }}>Cancel</button> : <><a href="/offline">View saved stories</a><button className="folio-primary" type="button" onClick={() => void save()}>{language === 'es' ? "Translate and save" : "Save offline"}</button></>}</div></section></div>;
}
