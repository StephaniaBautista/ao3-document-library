'use client';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

export default function DeleteAccount({ close, userId }: { close: () => void; userId?: string }) {
 const [password, setPassword] = useState('');
 const [message, setMessage] = useState('');
 const [pending, setPending] = useState(false);
 async function submit(event: FormEvent) {
  event.preventDefault(); setPending(true); setMessage('');
  try {
   const result = await authClient.deleteUser({ password });
   if (result.error) throw new Error("Could not delete your account. Check your password or try again later. If the problem persists, contact the administrator.");
   if (userId) { try { window.localStorage.removeItem(`library-preferences:${userId}`); } catch { /* Storage may be unavailable. */ } }
   window.location.reload();
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete the account.'); }
  finally { setPending(false); }
 }
 return <div className="modal-backdrop" onMouseDown={close}><form className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-account-title" onMouseDown={event => event.stopPropagation()} onSubmit={submit}>
  <h2 id="delete-account-title">Remove my account</h2><p>Your account and personal data will be deleted. The stories you provided will remain in the library without being associated with your account.</p>
  <label htmlFor="delete-account-password">Password</label><input id="delete-account-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/>
  {message && <p role="alert">{message}</p>}<div className="dialog-actions"><button type="button" className="btn secondary" onClick={close}>Cancel</button><button type="submit" className="btn primary" disabled={pending || !password}>{pending ? 'Deleting…' : "Delete account"}</button></div>
 </form></div>;
}
