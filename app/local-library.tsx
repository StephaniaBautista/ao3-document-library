'use client';

import { useEffect, useState } from 'react';
import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { parseAo3Header } from '@/lib/catalog/metadata.mjs';
import { readableDomContent } from '@/lib/catalog/dom-text';
import { driveFiles } from '@/lib/catalog/private-drive-browser';
import { publishLocalFile } from '@/lib/catalog/publish-local';
import { ReaderSettingsPanel, useReaderSettings } from './reader-settings';
import { AnchoredText, type Chapter, type TextAnchor } from './anchored-text';

type LocalStory = { id: string; owner: string; filename: string; title: string; author?: string; summary?: string; fandom?: string; relationship?: string; characters?: string; tags?: string; warnings?: string; ao3Url?: string; type: 'pdf' | 'epub'; page: number; anchor?: string; added: number };
type Section = import('epubjs/types/section').default;
async function* localFiles(files: File[]) { yield* files; }
const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
 const request = indexedDB.open('biblioteca-local-v1', 1);
 request.onupgradeneeded = () => { const db = request.result; const stories = db.createObjectStore('stories', { keyPath: 'id' }); stories.createIndex('owner', 'owner'); db.createObjectStore('files'); };
 request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
});
async function request<T>(query: (db: IDBDatabase) => IDBRequest<T>): Promise<T> {
 const db = await openDb();
 try { return await new Promise<T>((resolve, reject) => { const req = query(db); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
 finally { db.close(); }
}
async function saveStory(story: LocalStory, file?: Blob) {
 const db = await openDb();
 try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(['stories', 'files'], 'readwrite'); tx.objectStore('stories').put(story); if (file) tx.objectStore('files').put(file, story.id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
 finally { db.close(); }
}
async function removeStory(id: string) {
 const db = await openDb();
 try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(['stories', 'files'], 'readwrite'); tx.objectStore('stories').delete(id); tx.objectStore('files').delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
 finally { db.close(); }
}
async function pdfPage(file: Blob, index: number) {
 const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
 const task = pdfjs.getDocument({ data: await file.arrayBuffer(), disableAutoFetch: true, disableStream: true });
 try { const pdf = await task.promise; if (index >= pdf.numPages) throw Error("Page not available."); const page = await pdf.getPage(index + 1); const content = await page.getTextContent(); const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join(''); const links = await page.getAnnotations(); return { text, total: pdf.numPages, links: links.map(item => item.url || '').join('\n') }; }
 finally { await task.destroy(); }
}
async function validateEpub(file: Blob) {
 const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
 try {
  const entries = await reader.getEntries();
  if (entries.length > 10000 || entries.some(entry => entry.encrypted || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > 4 * 1024 * 1024) || entries.reduce((total, entry) => total + entry.uncompressedSize, 0) > 100 * 1024 * 1024) throw Error('EPUB is too large');
 } finally { await reader.close(); }
}
async function epubPage(file: Blob, index: number) {
 const { default: ePub } = await import('epubjs'); const book = ePub(await file.arrayBuffer());
 try {
  await book.ready; const sections: Section[] = []; book.spine.each((section: Section) => sections.push(section));
  const section = sections[index]; if (!section || /^[a-z][a-z0-9+.-]*:/i.test(section.href) || section.href.startsWith('//')) throw Error("Section not available.");
  await section.load(book.load.bind(book)); const clone = section.contents.cloneNode(true) as Element;
  const { text, anchors } = readableDomContent(clone), links = Array.from(clone.querySelectorAll('a[href]')).map(link => link.getAttribute('href')).join('\n');
  const meta = await book.loaded.metadata; section.unload();
  const navigation = await book.loaded.navigation;
  const chapters: Chapter[] = [];
  function visit(items: typeof navigation.toc) {
   for (const item of items) {
    if (chapters.length >= 500) return;
    if (item.href && !/^[a-z][a-z0-9+.-]*:/i.test(item.href) && !item.href.startsWith('//')) {
     const [href, rawAnchor] = item.href.split('#', 2);
     try {
      const anchor = rawAnchor ? decodeURIComponent(rawAnchor) : undefined;
      const target = book.spine.get(href || item.href), position = sections.indexOf(target);
      const title = item.label.trim().slice(0, 200);
      if (position >= 0 && title && (!anchor || anchor.length <= 256) && !chapters.some(chapter => chapter.page === position && chapter.anchor === anchor)) chapters.push({ title, page: position, ...(anchor ? { anchor } : {}) });
     } catch { /* Ignore malformed fragment escapes. */ }
    }
    if (item.subitems?.length) visit(item.subitems);
   }
  }
  visit(navigation.toc);
  return { text, links, total: sections.length, title: meta.title, author: meta.creator, chapters, anchors };
 } finally { book.destroy(); }
}
async function readPage(file: Blob, type: LocalStory['type'], index: number) { return type === 'pdf' ? pdfPage(file, index) : epubPage(file, index); }

export default function LocalLibrary({ userId, dark, onPublished }: { userId: string; dark: boolean; onPublished: () => void }) {
 const [stories, setStories] = useState<LocalStory[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState('');
 const [driveUrl, setDriveUrl] = useState(''), [driveOpen, setDriveOpen] = useState(false);
 const [publishDrive, setPublishDrive] = useState(false);
 useEffect(() => { if (sessionStorage.getItem('biblioteca-private-drive-open') === '1') { sessionStorage.removeItem('biblioteca-private-drive-open'); queueMicrotask(() => setDriveOpen(true)); } }, []);
 const [reading, setReading] = useState<LocalStory | null>(null), [file, setFile] = useState<Blob | null>(null), [page, setPage] = useState<{ text: string; total: number; chapters?: Chapter[]; anchors?: TextAnchor[] } | null>(null), [settingsOpen, setSettingsOpen] = useState(false);
 const reader = useReaderSettings(userId);
 async function reload() { const list = await request(db => db.transaction('stories').objectStore('stories').index('owner').getAll(userId)) as LocalStory[]; setStories(list.sort((a, b) => b.added - a.added)); }
 useEffect(() => { let active = true; void request(db => db.transaction('stories').objectStore('stories').index('owner').getAll(userId)).then(list => { if (active) setStories((list as LocalStory[]).sort((a, b) => b.added - a.added)); }).catch(() => { if (active) setMessage("The storage of this browser could not be opened."); }); return () => { active = false; }; }, [userId]);
 useEffect(() => { if (!reading || !file) return; let active = true; void readPage(file, reading.type, reading.page).then(value => { if (active) { setPage(value); setMessage(''); } }).catch(() => { if (active) { setPage(null); setMessage("This page could not be read. Scanned PDFs require OCR and can not be read here yet."); } }); return () => { active = false; }; }, [reading, file]);
 async function importFiles(files: AsyncIterable<File | null>, publish = false) {
  setBusy(true); let added = 0, duplicates = 0, failed = 0, processed = 0, published = 0, alreadyPublic = 0, publicationFailed = 0;
  const publicationSummary = () => publish ? ` Shared catalog: ${published} published · ${alreadyPublic} already existed · ${publicationFailed} unconfirmed.` : '';
  try {
   const existing = await request(db => db.transaction('stories').objectStore('stories').index('owner').getAll(userId)) as LocalStory[];
   const ids = new Set(existing.map(story => story.id)), urls = new Set(existing.map(story => story.ao3Url).filter(Boolean));
   for await (const file of files) {
    try {
     if (!file) throw Error("File not available");
     const type = /\.epub$/i.test(file.name) ? 'epub' : /\.pdf$/i.test(file.name) ? 'pdf' : null;
     if (!type || file.size <= 0 || file.size > 50 * 1024 * 1024) throw Error("File not compatible");
     if (type === 'epub') await validateEpub(file);
     const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
     const id = `${userId}:${hash}`;
     if (ids.has(id)) duplicates++;
     else {
      const first = await readPage(file, type, 0), metadata = parseAo3Header(`${first.text}\n${first.links}`);
      if (metadata.ao3Url && urls.has(metadata.ao3Url)) duplicates++;
      else {
       const fallback = first as { title?: string; author?: string };
       const story: LocalStory = { id, owner: userId, filename: file.name, type, title: metadata.title || fallback.title || file.name.replace(/\.(pdf|epub)$/i, ''), author: metadata.author || fallback.author, summary: metadata.summary, fandom: metadata.fandom, relationship: metadata.relationship, characters: metadata.characters, tags: metadata.tags, warnings: metadata.warnings, ao3Url: metadata.ao3Url, page: 0, added: Date.now() };
       await saveStory(story, file); ids.add(id); if (story.ao3Url) urls.add(story.ao3Url); added++;
      }
     }
     if (publish) {
      try { const result = await publishLocalFile(file); if (result.duplicate) alreadyPublic++; else published++; }
      catch { publicationFailed++; }
     }
    } catch { failed++; }
    finally { processed++; if (processed === 1 || processed % 5 === 0) setMessage(`${processed} procesadas · ${added} added · ${duplicates} duplicates · ${failed} failed.${publicationSummary()}`); }
   }
   await reload(); setMessage(`${added} added · ${duplicates} duplicates · ${failed} could not be imported.${publicationSummary()}`);
  } catch (error) { await reload().catch(() => {}); setMessage(`${added} added · ${duplicates} duplicates · ${failed} could not be imported.${publicationSummary()} ${error instanceof Error ? error.message : "Could not complete the import."}`); }
  finally { if (publish) { setPublishDrive(false); onPublished(); } setBusy(false); }
 }
 async function open(story: LocalStory) { try { const stored = await request(db => db.transaction('files').objectStore('files').get(story.id)) as Blob | undefined; if (!stored) throw Error(); setFile(stored); setPage(null); setReading(story); } catch { setMessage("The local file couldn't be opened."); } }
 async function makePublic(story: LocalStory) {
  if (!window.confirm(`Publish “${story.title}” in the shared catalog? Everyone with library access can read it. Your local copy will be kept.`)) return;
  setBusy(true); setMessage("Publishing story…");
  try {
   const stored = await request(db => db.transaction('files').objectStore('files').get(story.id)) as Blob | undefined;
   if (!stored) throw new Error('Could not open the local file.');
   const file = new File([stored], story.filename, { type: story.type === 'pdf' ? 'application/pdf' : 'application/epub+zip' });
   const result = await publishLocalFile(file, story);
   setMessage(result.duplicate ? "This story already exists in the shared catalog." : "Story published to the shared catalog. Your local copy has been kept.");
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not publish the story.'); }
  finally { onPublished(); setBusy(false); }
 }
 async function move(next: number, anchor?: string) { if (!reading || !page || next < 0 || next >= page.total) return; const updated = { ...reading, page: next, anchor }; setPage(null); setReading(updated); try { await saveStory(updated); } catch { setMessage("Could not save your progress in this browser."); } }
 const visible = stories.filter(story => [story.title, story.author, story.fandom, story.relationship, story.characters, story.tags].some(value => value?.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
 return <section className="local-library"><div className="folio-heading"><div><h2>Files in this browser</h2><p>These files are saved in this browser and only shared if you choose to make them public. They can be deleted when cleaning the browser data; other people with access to this profile might see them.</p></div></div>
  <label className="folio-primary local-upload">{busy ? 'Importing…' : 'Add PDF or EPUB'}<input type="file" accept=".pdf,.epub,application/pdf,application/epub+zip" multiple disabled={busy} onChange={event => { if (event.target.files) void importFiles(localFiles(Array.from(event.target.files))); event.target.value = ''; }}/></label>{' '}
  <button type="button" className="folio-secondary" disabled={busy} aria-expanded={driveOpen} aria-controls="private-drive-import" onClick={() => setDriveOpen(!driveOpen)}>Import from Google Drive</button>
  {driveOpen && <form id="private-drive-import" className="private-drive-import" onSubmit={event => { event.preventDefault(); void importFiles(driveFiles(driveUrl), publishDrive); }}><p>Google requests read-only access to the files of the connected account. The connection is saved encrypted on the server. Files pass through the server and are saved in this browser. They are only published if you choose to share them.</p><p>PDF and EPUB are imported up to 50 MB, including subfolders. Keep this page open while importing.</p><div className="private-drive-actions"><button type="button" className="folio-secondary" disabled={busy} onClick={() => { void (async () => { try { const res = await fetch('/api/drive/connect', { method: 'POST' }); const data = await res.json() as { url?: string; error?: string }; if (!res.ok || !data.url) throw new Error(data.error || 'Could not connect to Drive.'); sessionStorage.setItem('biblioteca-private-drive-return', '1'); window.location.assign(data.url); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect to Drive.'); } })(); }}>Connect my Google Drive</button><button type="button" className="folio-secondary" disabled={busy} onClick={() => { void fetch('/api/drive/connect', { method: 'DELETE' }).then(res => { if (!res.ok) throw new Error(); setMessage("Google Drive access has been revoked and the connection removed."); }).catch(() => setMessage("The connection could not be deleted.")); }}>Disconnect Drive</button></div><label>Link to Drive folder<input type="url" required disabled={busy} maxLength={2048} value={driveUrl} onChange={event => setDriveUrl(event.target.value)} placeholder="https://drive.google.com/drive/folders/…"/></label><fieldset className="private-drive-visibility" disabled={busy}><legend>Visibility of this import</legend><label><input type="radio" name="drive-visibility" checked={!publishDrive} onChange={() => setPublishDrive(false)}/> Only in this browser</label><label><input type="radio" name="drive-visibility" checked={publishDrive} onChange={() => setPublishDrive(true)}/> Make stories public in the shared catalog</label><p>{publishDrive ? "All people with access to the library will be able to read the published stories. A copy will also be kept in this browser." : "The stories will not appear in the shared catalogue."}</p></fieldset><button className="folio-primary" disabled={busy || !driveUrl.trim()}>{busy ? 'Importing…' : publishDrive ? "Import and publicize" : "Import to this browser"}</button></form>}
  <label className="folio-search"><span className="sr-only">Find local files</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search for local files"/></label>
  {message && <p role="status">{message}</p>}{!visible.length ? <p>There are no local files to show.</p> : <ul className="local-stories">{visible.map(story => <li key={story.id}><button type="button" className="folio-link" onClick={() => void open(story)}>{story.title}</button><span>{story.author || 'Unknown author'} · {story.type.toUpperCase()}</span><button type="button" className="folio-secondary" disabled={busy} onClick={() => void makePublic(story)}>Make public</button><button type="button" className="folio-secondary" disabled={busy} onClick={() => { if (!window.confirm(`Delete “${story.title}” from this browser?`)) return; void removeStory(story.id).then(reload).catch(() => setMessage("The file could not be deleted.")); }}>Delete</button></li>)}</ul>}
  {reading && <div className="folio-reader" data-theme={dark ? 'dark' : 'light'} data-sepia={!dark && reader.settings.sepia ? 'true' : undefined} style={reader.style}><header className="folio-reader-bar"><button type="button" className="folio-reader-back" onClick={() => { setReading(null); setFile(null); setPage(null); void reload(); }}>Library</button><div><strong>{reading.title}</strong><small>{reading.author}</small></div><button type="button" className="folio-reader-type" aria-label="Customize reading" title="Customize reading" onClick={() => setSettingsOpen(true)}>Aa</button></header><div className="folio-reader-scroll"><div className="folio-reader-inner"><p>Local file · {reading.page + 1}{page ? ` / ${page.total}` : ''}</p>{page?.chapters && page.chapters.length > 0 && <label className="reader-chapters">Contents<select value="" onChange={event => { if (event.target.value === '') return; const chapter = page.chapters?.[Number(event.target.value)]; if (chapter) void move(chapter.page, chapter.anchor); }}><option value="">Choose Chapter</option>{page.chapters.map((chapter, index) => <option key={index} value={index}>{chapter.title}</option>)}</select></label>}{message && <p role="status">{message}</p>}{page ? <article className="folio-reader-text">{page.text.trim() ? <AnchoredText text={page.text} anchors={page.anchors} target={reading.anchor ? { page: reading.page, anchor: reading.anchor, sequence: 0 } : null}/> : <p>This page does not contain extractable text. Local OCR is not available yet.</p>}</article> : <p>Preparing reading...</p>}<div className="folio-reader-pagination"><button type="button" className="folio-secondary" disabled={!page || reading.page === 0} onClick={() => void move(reading.page - 1)}>Previous</button><button type="button" className="folio-secondary" disabled={!page || reading.page + 1 >= page.total} onClick={() => void move(reading.page + 1)}>Next</button></div></div></div>{settingsOpen && <ReaderSettingsPanel settings={reader.settings} update={reader.update} close={() => setSettingsOpen(false)}/>}</div>}
 </section>;
}
