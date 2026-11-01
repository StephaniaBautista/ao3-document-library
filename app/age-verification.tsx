'use client';

import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';
import DeleteAccount from './delete-account';

export default function AgeVerification({ blocked = false, userId }: { blocked?: boolean; userId: string }) {
 const [confirmed, setConfirmed] = useState(false);
 const [message, setMessage] = useState('');
 const [pending, setPending] = useState(false);
 const [deleting, setDeleting] = useState(false);
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!confirmed) return;
  setPending(true); setMessage('');
  try {
   const res = await fetch('/api/age-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
   if (!res.ok) throw new Error("Could not save your confirmation. Please try again.");
   window.location.reload();
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not continue.'); }
  finally { setPending(false); }
 }
 return <>
  <div className="access-heading"><span className="access-section-label">ACCESS</span><h1 id="access-title">{blocked ? "Account not available" : "Confirm your age"}</h1><p>{blocked ? "It is not possible to access this account." : "The library is for people 18 years or older."}</p></div>
  {!blocked && <form className="access-form" onSubmit={submit}>
   <label className="age-confirmation"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> <span>I confirm I&apos;m 18 years old or older.</span></label>
   <button className="access-submit" type="submit" disabled={pending || !confirmed}>{pending ? 'Saving…' : 'Continue'}</button>
  </form>}
  {message && <p className="access-status" role="alert">{message}</p>}
  {deleting && <DeleteAccount userId={userId} close={() => setDeleting(false)}/>}
  <div className="access-switch"><button type="button" onClick={() => setDeleting(true)}>Remove my account</button></div>
  <div className="access-switch"><button type="button" onClick={async () => { await authClient.signOut(); window.location.reload(); }}>Logout</button></div>
 </>;
}
