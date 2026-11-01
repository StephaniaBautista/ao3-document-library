'use client';
import { useEffect, useState, type FormEvent } from 'react';

type Job = { id: string; state: string; createdAt: number };
type ImportProgress = { state: string; counts: { state: string; count: number }[]; failures: { id: string; name: string; error: string | null; path: string }[]; nextFailureCursor: string | null; duplicates: { id: string; storyId: string; title: string; sourceImportCreatedAt: number; sourceFolderId: string | null; sourceFolderAvailable: boolean; currentFolderId: string | null; sourcePath: string; currentFolderPath: string }[]; nextDuplicateCursor: string | null };
const stateLabel: Record<string, string> = { pending: 'Pending', processing: 'In progress', done: 'Completed', failed: 'With errors', running: 'In progress' };
export default function DriveImport({ close }: { close: () => void }) {
 const [url, setUrl] = useState('');
 const [jobs, setJobs] = useState<Job[]>([]);
 const [selected, setSelected] = useState('');
 const [progress, setProgress] = useState<ImportProgress | null>(null);
 const [failurePages, setFailurePages] = useState<(string | null)[]>([null]);
 const [failurePage, setFailurePage] = useState(0);
 const [duplicatePages, setDuplicatePages] = useState<(string | null)[]>([null]);
 const [duplicatePage, setDuplicatePage] = useState(0);
 const [pollVersion, setPollVersion] = useState(0);
 const [message, setMessage] = useState('');
 const [pending, setPending] = useState(false);
 const [running, setRunning] = useState(false);
 const [retrying, setRetrying] = useState(false);
 const [moving, setMoving] = useState('');
 const failureCursor = failurePages[failurePage];
 const duplicateCursor = duplicatePages[duplicatePage];
 useEffect(() => {
  let cancelled = false;
  void fetch('/api/admin/drive/imports').then(async res => { if (!res.ok) throw new Error('Could not load imports.'); return res.json() as Promise<{ jobs: Job[] }>; }).then(data => { if (!cancelled) setJobs(data.jobs); }).catch(error => { if (!cancelled) setMessage(error.message); });
  return () => { cancelled = true; };
 }, []);
 useEffect(() => {
  if (!selected) return;
  let cancelled = false, inFlight = false;
  async function poll() {
   if (inFlight) return;
   inFlight = true;
   try {
    if (running) { const step = await fetch(`/api/admin/drive/imports/${selected}`, { method: 'POST' }); if (!step.ok) throw new Error("Could not advance the import."); }
    const params = new URLSearchParams();
    if (failureCursor) params.set('afterId', failureCursor);
    if (duplicateCursor) params.set('afterDuplicateId', duplicateCursor);
    const query = params.size ? `?${params}` : '';
    const res = await fetch(`/api/admin/drive/imports/${selected}${query}`, { cache: 'no-store' });
    if (!res.ok) throw new Error("Could not check the import.");
    const data = await res.json() as Omit<ImportProgress, 'state'> & { job: Job };
    if (!cancelled) {
     if (data.job.state === 'done' || data.job.state === 'failed') setRunning(false);
     setProgress({ state: data.job.state, counts: data.counts, failures: data.failures, nextFailureCursor: data.nextFailureCursor, duplicates: data.duplicates, nextDuplicateCursor: data.nextDuplicateCursor });
     setJobs(old => old.some(job => job.id === selected && job.state !== data.job.state) ? old.map(job => job.id === selected ? { ...job, state: data.job.state } : job) : old);
    }
   } catch (error) { if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not check the import."); }
   finally { inFlight = false; }
  }
  void poll(); const timer = window.setInterval(() => void poll(), 5000);
  return () => { cancelled = true; window.clearInterval(timer); };
 }, [selected, failureCursor, duplicateCursor, pollVersion, running]);
 async function connect() {
  setPending(true); setMessage('');
  try {
   const res = await fetch('/api/admin/drive/connect', { method: 'POST' });
   const data = await res.json() as { url?: string; error?: string };
   if (!res.ok || !data.url) throw new Error(data.error || 'Could not connect to Drive.');
   window.location.assign(data.url);
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect to Drive.'); }
  finally { setPending(false); }
 }
 async function submit(event: FormEvent) {
  event.preventDefault(); setPending(true); setMessage('');
  try {
   const folderUrls = url.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
   const res = await fetch('/api/admin/drive/imports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderUrls }) });
   const data = await res.json() as { id?: string; error?: string };
   if (!res.ok || !data.id) throw new Error(data.error || "Could not start the import.");
   setRunning(true); setSelected(data.id); setFailurePages([null]); setFailurePage(0); setDuplicatePages([null]); setDuplicatePage(0); setProgress(null); setJobs(old => [{ id: data.id!, state: 'pending', createdAt: Date.now() }, ...old]); setUrl('');
  } catch (error) { setMessage(error instanceof Error ? error.message : "Could not start the import."); }
  finally { setPending(false); }
 }
 async function retryMetadata() {
  const res = await fetch('/api/admin/metadata', { method: 'POST' });
  if (!res.ok) { setMessage("Could not retry metadata extraction."); return; }
  const data = await res.json() as { queued: number };
  setMessage(`${data.queued} metadata records will be prepared again.`);
 }
 async function retry() {
  if (retrying) return;
  setRetrying(true); setMessage('');
  try {
   const res = await fetch(`/api/admin/drive/imports/${selected}`, { method: 'PATCH' });
   if (!res.ok) throw new Error('Could not retry the files.');
   setFailurePages([null]); setFailurePage(0); setProgress(null); setPollVersion(value => value + 1);
   setRunning(true); setMessage("The remaining files will be imported again.");
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not retry the files.'); }
  finally { setRetrying(false); }
 }
 async function moveToSource(item: ImportProgress['duplicates'][number]) {
  if (moving || !item.sourceFolderAvailable) return;
  setMoving(item.id); setMessage('');
  try {
   const res = await fetch(`/api/catalog/stories/${encodeURIComponent(item.storyId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: item.sourceFolderId }) });
   if (!res.ok) throw new Error('Could not move the story. The folder or story may have changed.');
   setMessage("Story moved to the selected folder."); setPollVersion(value => value + 1);
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not move the story.'); }
  finally { setMoving(''); }
 }
 return <div className="modal-backdrop" onMouseDown={close}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="drive-title" onMouseDown={event => event.stopPropagation()}>
  <h2 id="drive-title">Import from Google Drive</h2><p>Connect the account that has access to the folders. Files will be copied to the shared catalog, where other users can read them. Keep this window open during the import.</p><button type="button" className="btn secondary" disabled={pending} onClick={() => void connect()}>Connect Google Drive</button>
  <form onSubmit={submit}><label htmlFor="drive-folder">Links of the main folders, one per line</label><textarea id="drive-folder" required rows={4} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://drive.google.com/drive/folders/…"/><button className="btn primary" disabled={pending || !url.trim()}>Import collection</button></form>
  {!!jobs.length && <><label htmlFor="drive-job">Imports</label><select id="drive-job" value={selected} disabled={retrying || !!moving} onChange={event => { setRunning(false); setSelected(event.target.value); setFailurePages([null]); setFailurePage(0); setDuplicatePages([null]); setDuplicatePage(0); setProgress(null); setMessage(''); }}><option value="">Select an import</option>{jobs.map(job => <option key={job.id} value={job.id}>{new Date(job.createdAt).toLocaleString()} · {stateLabel[job.state] || job.state}</option>)}</select></>}
  {selected && !progress && !message && <p role="status">Checking the import...</p>}
  {progress && !running && (progress.state === 'pending' || progress.state === 'running') && <button type="button" className="btn secondary" onClick={() => setRunning(true)}>Continue this import</button>}
  {progress && <><p>Status: {stateLabel[progress.state] || progress.state}</p>{progress.counts.map(count => <p key={count.state}>{stateLabel[count.state] || count.state}: {count.count}</p>)}{progress.failures.map(failure => <p className="drive-failure" key={failure.id}><strong>{failure.path}</strong>: {failure.error || 'Could not import this item.'}</p>)}{(failurePage > 0 || progress.nextFailureCursor) && <div className="dialog-actions"><button type="button" className="btn secondary" disabled={failurePage === 0} onClick={() => { setFailurePage(value => value - 1); setProgress(null); }}>Previous</button><span>Page {failurePage + 1}</span><button type="button" className="btn secondary" disabled={!progress.nextFailureCursor} onClick={() => { if (!progress.nextFailureCursor) return; setFailurePages(old => [...old.slice(0, failurePage + 1), progress.nextFailureCursor]); setFailurePage(value => value + 1); setProgress(null); }}>Next</button></div>}{progress.counts.some(count => count.state === 'failed' && count.count > 0) && <button type="button" className="btn secondary" disabled={retrying} onClick={() => void retry()}>{retrying ? 'Preparing…' : "Retry pending files"}</button>}</>}
  {progress && (progress.duplicates.length > 0 || duplicatePage > 0) && <section aria-labelledby="duplicate-title"><h3 id="duplicate-title">Repeated stories</h3><p>One copy is preserved. Here are also your locations found in other imports; you can choose where to place it.</p>{progress.duplicates.map(item => <article className="drive-failure" key={item.id}><strong>{item.title}</strong><p>Found in: {item.sourcePath}</p><p>Import: {new Date(item.sourceImportCreatedAt).toLocaleString()}</p><p>Current location: {item.currentFolderPath}</p><button type="button" className="btn secondary" disabled={!!moving || !item.sourceFolderAvailable || item.sourceFolderId === item.currentFolderId} onClick={() => void moveToSource(item)}>{moving === item.id ? 'Moving…' : !item.sourceFolderAvailable ? "Folder no longer available" : item.sourceFolderId === item.currentFolderId ? "It's already in this folder." : "Move to this folder"}</button></article>)}{(duplicatePage > 0 || progress.nextDuplicateCursor) && <div className="dialog-actions"><button type="button" className="btn secondary" disabled={!!moving || duplicatePage === 0} onClick={() => { setDuplicatePage(value => value - 1); setProgress(null); }}>Previous</button><span>Repeats page {duplicatePage + 1}</span><button type="button" className="btn secondary" disabled={!!moving || !progress.nextDuplicateCursor} onClick={() => { if (!progress.nextDuplicateCursor) return; setDuplicatePages(old => [...old.slice(0, duplicatePage + 1), progress.nextDuplicateCursor]); setDuplicatePage(value => value + 1); setProgress(null); }}>Next</button></div>}</section>}
  <button type="button" className="btn secondary" onClick={() => void retryMetadata()}>Retry metadata extraction</button>
  {message && <p role="status">{message}</p>}<button type="button" className="btn secondary" onClick={close}>Close</button>
 </section></div>;
}
