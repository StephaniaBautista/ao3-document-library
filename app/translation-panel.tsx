'use client';

import { useEffect, useRef, useState } from 'react';
import { Languages } from 'lucide-react';
import { extractTranslationSegments } from '@/lib/catalog/extract-text';
import type { TranslationWindow } from '@/lib/catalog/translation-window';
import { waitForTranslationProgress } from '@/lib/catalog/translation-progress.mjs';

type FileReference = { id: string; type: 'pdf' | 'epub' };
export default function TranslationPanel({ file, position, onWindow, onJobReady }: { file: FileReference; position: number; onWindow: (window: TranslationWindow | null) => void; onJobReady: (jobId: string, readingPosition: number) => void }) {
 const [languages, setLanguages] = useState<{ language: string; name: string }[]>([]);
 const [language, setLanguage] = useState('es');
 const [job, setJob] = useState('');
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState('');
 const [windowData, setWindowData] = useState<TranslationWindow | null>(null);
 const [extractionState, setExtractionState] = useState('');
 const [pollRevision, setPollRevision] = useState(0);
 const initializedJob = useRef('');
 const lastExtractionState = useRef('');
 const selectionRevision = useRef(0);
 const languageChanged = useRef(false);
 const callback = useRef(onWindow);
 const jobReady = useRef(onJobReady);
 useEffect(() => { callback.current = onWindow; }, [onWindow]);
 useEffect(() => { jobReady.current = onJobReady; }, [onJobReady]);
 useEffect(() => { let cancelled = false; void fetch('/api/me/language').then(res => res.ok ? res.json() as Promise<{ language: string }> : null).then(data => { if (!cancelled && !languageChanged.current && data) setLanguage(data.language); }).catch(() => {}); return () => { cancelled = true; }; }, []);
 useEffect(() => {
  let cancelled = false;
  void fetch('/api/translations/languages').then(async res => {
   const data = await res.json() as { languages?: { language: string; name: string }[]; error?: string };
   if (!res.ok) throw new Error(data.error || 'Could not load languages.');
   if (!cancelled) setLanguages(data.languages || []);
  }).catch(error => { if (!cancelled) setMessage(error.message); });
  return () => { cancelled = true; };
 }, []);
 useEffect(() => {
  if (!job) return;
  let cancelled = false;
  const revision = selectionRevision.current;
  const poll = async () => {
   try {
    if (initializedJob.current !== job) await waitForTranslationProgress(job);
    if (cancelled || revision !== selectionRevision.current) return;
    const query = initializedJob.current === job ? `?position=${position}` : '';
    const res = await fetch(`/api/translations/${job}/window${query}`, { cache: 'no-store' });
    if (!res.ok) throw new Error("Could not check the translation.");
    let data = await res.json() as TranslationWindow;
    if (initializedJob.current === job && lastExtractionState.current === 'browser' && ['failed', 'pending', 'processing'].includes(data.extractionState)) {
     await waitForTranslationProgress(job).catch(() => {});
     const restored = await fetch(`/api/translations/${job}/window`, { cache: 'no-store' });
     if (!restored.ok) throw new Error("Could not check the translation.");
     data = await restored.json() as TranslationWindow;
     if (!cancelled && revision === selectionRevision.current) initializedJob.current = '';
    }
    if (!cancelled && revision === selectionRevision.current) lastExtractionState.current = data.extractionState;
    if (!cancelled && revision === selectionRevision.current) { if (initializedJob.current !== job) { initializedJob.current = job; jobReady.current(job, data.segment?.position ?? data.readingPosition); } else if (data.segment && data.segment.position !== position && data.extractionState === 'done') jobReady.current(job, data.segment.position); setExtractionState(data.extractionState); setWindowData(data); callback.current(data); }
   } catch (error) { if (!cancelled && revision === selectionRevision.current) setMessage(error instanceof Error ? error.message : "Could not check the translation."); }
  };
  void poll(); const timer = window.setInterval(() => void poll(), 5000);
  return () => { cancelled = true; window.clearInterval(timer); };
 }, [job, position, pollRevision]);
 async function start(forceBrowser = false) {
  setBusy(true); setMessage('Preparing text…');
  let browserClaim = '', browserJob = '';
  try {
   const res = await fetch('/api/translations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storyId: file.id, target: language }) });
   const data = await res.json() as { id?: string; error?: string; serverExtraction?: boolean; extractionState?: string };
   if (!res.ok || !data.id) throw new Error(data.error || "Could not start the translation.");
   const jobId = data.id; selectionRevision.current++; initializedJob.current = ''; lastExtractionState.current = ''; setJob(jobId); setWindowData(null); callback.current(null); setPollRevision(value => value + 1);
   if (data.extractionState === 'done') { setMessage("The prepared translation is available."); return; }
   if (data.serverExtraction && !forceBrowser) { setMessage("The story is being prepared and translated in the background."); return; }
   await waitForTranslationProgress(jobId).catch(() => {});
   const claimResponse = await fetch(`/api/translations/${jobId}/segments`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ browser: true }) });
   const claimData = await claimResponse.json() as { claim?: string; error?: string };
   if (!claimResponse.ok || !claimData.claim) throw new Error(claimData.error || "Could not start preparation on this device.");
   const claim = claimData.claim;
   browserClaim = claim; browserJob = jobId;
   initializedJob.current = ''; lastExtractionState.current = ''; setPollRevision(value => value + 1);
   let position = 0, pending: { position: number; text: string }[] = [];
   const upload = async () => {
    if (!pending.length) return;
    const batch = pending; pending = [];
    const response = await fetch(`/api/translations/${jobId}/segments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segments: batch, claim }) });
    if (!response.ok) throw new Error('Could not prepare all the text. Please try again.');
   };
   for await (const text of extractTranslationSegments(file)) {
    pending.push({ position: position++, text });
    if (position === 1 || pending.length >= 50) await upload();
   }
   await upload();
   if (!position) throw new Error("No readable text was found. The document may need OCR.");
   const completed = await fetch(`/api/translations/${jobId}/segments`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ complete: true, claim }) });
   if (!completed.ok) throw new Error("Could not confirm preparation. Please try again.");
   browserClaim = '';
   setMessage("The rest will continue to translate in the background.");
  } catch (error) {
   if (browserClaim) {
    await waitForTranslationProgress(browserJob).catch(() => {});
    const restored = await fetch(`/api/translations/${browserJob}/segments`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ failed: true, claim: browserClaim }) }).catch(() => null);
    if (restored?.ok) { initializedJob.current = ''; lastExtractionState.current = ''; setPollRevision(value => value + 1); }
   }
   setMessage(error instanceof Error ? error.message : "Could not start the translation.");
  }
  finally { setBusy(false); }
 }
 async function retry() {
  const res = await fetch(`/api/translations/${job}/segments`, { method: 'PATCH' });
  if (!res.ok) setMessage("Could not retry the translation.");
  else setMessage("The pending translation will be retried.");
 }
 return <aside className="translate-panel"><div className="translate-heading"><div className="translate-icon"><Languages size={20}/></div><div><h2>Translate story</h2><span>Automatic translation</span></div></div>
  <p>Select a language to translate the full text.</p><label htmlFor="target-language">Language</label><select id="target-language" value={language} onChange={event => { const value = event.target.value; languageChanged.current = true; selectionRevision.current++; initializedJob.current = ''; setLanguage(value); setJob(''); setWindowData(null); setExtractionState(''); setMessage(''); callback.current(null); void fetch('/api/me/language', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: value }) }); }} disabled={!languages.length || busy}>{languages.map(item => <option key={item.language} value={item.language}>{item.name || item.language}</option>)}</select>
  <button className="btn primary translate-button" type="button" disabled={!languages.length || busy} onClick={() => void start()}><Languages size={17}/>{busy ? 'Preparing…' : 'Translate'}</button>
  {!!windowData?.total && <p role="status">{windowData.completed} of {windowData.total} segments translated.</p>}{extractionState === 'failed' && <>{!!windowData?.total && <p className="translate-note">If preparation on this device fails, your previous progress will be restored.</p>}<button className="btn secondary" type="button" disabled={busy} onClick={() => void start(true)}>Prepare on this device</button></>}{((windowData?.failed ?? 0) > 0 || extractionState === 'failed') && <button className="btn secondary" type="button" onClick={() => void retry()}>Retry segments</button>}{message && <p className="translate-note" role="status">{message}</p>}
 </aside>;
}
