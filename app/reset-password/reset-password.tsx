'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';

export default function ResetPassword() {
 const [token, setToken] = useState<string | null>(null);
 const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
 const [show, setShow] = useState(false); const [showConfirm, setShowConfirm] = useState(false);
 const [error, setError] = useState(''); const [pending, setPending] = useState(false); const [done, setDone] = useState(false);
 useEffect(() => {
   const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
   window.history.replaceState(null, '', window.location.pathname);
   // URL fragments are available only after hydration and are cleared immediately.
   // eslint-disable-next-line react-hooks/set-state-in-effect
   setToken(value);
 }, []);
 async function submit(event: FormEvent<HTMLFormElement>) {
   event.preventDefault(); setError('');
   if (password !== confirm) { setError("Passwords don't match."); return; }
   setPending(true);
   try { const result = await authClient.resetPassword({newPassword: password, token: token || ''});
     if (result.error) setError("The link is not valid or expired. Request a new one."); else setDone(true);
   } catch { setError("Something went wrong. Please try again."); } finally { setPending(false); }
 }
 return <><div className="access-heading"><span className="access-section-label">ACCOUNT</span><h1 id="access-title">{done ? "Updated password" : "Choose a new password"}</h1><p>{done ? "You can already log in with your new password." : token === null ? 'Checking the link…' : !token ? "The link is not valid or expired. Request a new one." : "Enter a new password for your account."}</p></div>
 {!done && token && <form className="access-form" onSubmit={submit}>
   <div className="access-field"><label htmlFor="new-password">New password</label><div className="access-password-control"><input id="new-password" type={show ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)} aria-describedby="new-password-hint"/><button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={()=>setShow(!show)}>{show ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div><span className="access-hint" id="new-password-hint">At least 12 characters</span></div>
   <div className="access-field"><label htmlFor="confirm-new-password">Confirm password</label><div className="access-password-control"><input id="confirm-new-password" type={showConfirm ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} required value={confirm} onChange={e=>setConfirm(e.target.value)}/><button type="button" aria-label={showConfirm ? "Hide password confirmation" : "Show password confirmation"} onClick={()=>setShowConfirm(!showConfirm)}>{showConfirm ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></div>
   {error && <p className="access-error" role="alert">{error}</p>}<button className="access-submit" disabled={pending} type="submit">{pending ? 'Please wait…' : "Update password"}</button>
 </form>}
 <div className="access-switch"><Link href="/">Back to Log In</Link></div></>;
}
