'use client';
import { useEffect, useState } from 'react';
type Cursor = { createdAt: number; id: string };
export default function NotificationIssues({ close }: { close: () => void }) {
 const [items, setItems] = useState<{ id: string; state: string; email: string }[]>([]);
 const [cursor, setCursor] = useState<Cursor | null>(null);
 const [loading, setLoading] = useState(true);
 const [storage, setStorage] = useState<{ count: number; oldest: number | null } | null>(null);
 const [checkingStorage, setCheckingStorage] = useState(false);
 const [message, setMessage] = useState('');
 useEffect(() => {
  let cancelled = false;
  void fetch('/api/admin/notifications').then(async res => { if (!res.ok) throw new Error('Could not load notices.'); return res.json() as Promise<{ notifications: typeof items; nextCursor: Cursor | null }>; }).then(data => { if (!cancelled) { setItems(data.notifications); setCursor(data.nextCursor); } }).catch(error => { if (!cancelled) setMessage(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
  void fetch('/api/admin/storage-cleanup').then(async res => { if (!res.ok) throw new Error('Could not check storage.'); return res.json() as Promise<{ count: number; oldest: number | null }>; }).then(data => { if (!cancelled) setStorage(data); }).catch(error => { if (!cancelled) setMessage(error.message); });
  return () => { cancelled = true; };
 }, []);
 async function loadMore() {
  if (!cursor || loading) return;
  setLoading(true); setMessage('');
  try {
   const params = new URLSearchParams({ afterTime: String(cursor.createdAt), afterId: cursor.id });
   const res = await fetch(`/api/admin/notifications?${params}`);
   if (!res.ok) throw new Error("Could not load more notices.");
   const data = await res.json() as { notifications: typeof items; nextCursor: Cursor | null };
   setItems(old => [...old, ...data.notifications.filter(item => !old.some(previous => previous.id === item.id))]);
   setCursor(data.nextCursor);
  } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load more notices."); }
  finally { setLoading(false); }
 }
 async function decide(id: string, decision: 'retry' | 'confirm_sent', uncertain: boolean) {
  const question = uncertain ? decision === 'retry' ? "Confirm in Postmark that this email was not sent. Retrying without checking could send it twice. Continue?" : "Confirm in Postmark that this email was sent. The included reminders will be deleted. Continue?" : "Retry this email?";
  if (!window.confirm(question)) return;
  const res = await fetch(`/api/admin/notifications/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) });
  if (res.ok) setItems(old => old.filter(item => item.id !== id)); else setMessage("The notice could not be updated.");
 }
 async function retryStorage() {
  setCheckingStorage(true); setMessage('');
  try {
   const res = await fetch('/api/admin/storage-cleanup', { method: 'POST' });
   if (!res.ok) throw new Error('Could not retry storage cleanup.');
   setStorage(await res.json() as { count: number; oldest: number | null });
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not retry cleanup.'); }
  finally { setCheckingStorage(false); }
 }
 return <div className="modal-backdrop" onMouseDown={close}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="notification-issues-title" onMouseDown={event => event.stopPropagation()}><h2 id="notification-issues-title">Pending tasks</h2><h3>Emails</h3><p>Check Postmark for any uncertain delivery before deciding what to do.</p>{items.map(item => <article key={item.id}><h3>{item.email}</h3><p>{item.state === 'unknown' ? 'Delivery uncertain' : item.state === 'sending' ? "Delivery in progress or unconfirmed" : "Delivery rejected"}</p>{item.state !== 'sending' && <div className="dialog-actions"><button type="button" className="btn secondary" onClick={() => void decide(item.id, 'retry', item.state === 'unknown')}>Retry</button>{item.state === 'unknown' && <button type="button" className="btn primary" onClick={() => void decide(item.id, 'confirm_sent', true)}>Confirm sent</button>}</div>}</article>)}{loading && <p role="status">Loading notices…</p>}{!loading && !items.length && !cursor && !message && <p>No emails are awaiting review.</p>}{cursor && <button type="button" className="btn secondary" disabled={loading} onClick={() => void loadMore()}>Load more</button>}<h3>Removing files</h3>{storage ? <><p>{storage.count ? `${storage.count} file(s) pending deletion from storage.` : "There are no pending deletion files."}</p>{storage.count > 0 && <button type="button" className="btn secondary" disabled={checkingStorage} onClick={() => void retryStorage()}>{checkingStorage ? 'Retrying…' : "Retry cleanup"}</button>}</> : <p>Checking storage…</p>}{message && <p role="alert">{message}</p>}<button type="button" className="btn secondary" onClick={close}>Close</button></section></div>;
}
