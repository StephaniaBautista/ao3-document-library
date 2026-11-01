'use client';
import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { authClient } from '@/lib/auth-client';

type Mode = 'sign-in' | 'register' | 'forgot' | 'check-email' | 'reset-requested';

export default function AuthForm() {
 const [mode, setMode] = useState<Mode>('sign-in');
 const [name, setName] = useState('');
 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [confirm, setConfirm] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [showConfirm, setShowConfirm] = useState(false);
 const [error, setError] = useState('');
 const [notice, setNotice] = useState('');
 const [needsVerification, setNeedsVerification] = useState(false);
 const [pending, setPending] = useState(false);
 const register = mode === 'register';
 function changeMode(next: Mode) { setMode(next); setError(''); setNotice(''); setNeedsVerification(false); setShowPassword(false); setShowConfirm(false); }
 async function submit(event: FormEvent<HTMLFormElement>) {
   event.preventDefault(); setError(''); setNotice(''); setNeedsVerification(false);
   if (register && password !== confirm) { setError("Passwords don't match."); return; }
   setPending(true);
   try {
     if (mode === 'forgot') {
       const result = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: '/reset-password' });
       if (result.error?.status === 429) { setError('Too many attempts. Please wait and try again.'); }
       else if (result.error) { setError("The request could not be processed. Try again."); }
       else { changeMode('reset-requested'); }
     } else if (register) {
       const result = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password, callbackURL: '/' });
       if (result.error) setError(result.error.status === 429 ? 'Too many attempts. Please wait and try again.' : "Could not create the account or send the email. Please try again.");
       else changeMode('check-email');
     } else {
       const result = await authClient.signIn.email({ email: email.trim(), password });
       if (result.error) {
         const unverified = result.error.code === 'EMAIL_NOT_VERIFIED';
         setNeedsVerification(unverified);
         setError(result.error.status === 429 ? 'Too many attempts. Please wait and try again.' : unverified ? "Verify your email before signing in." : "The email or password is incorrect.");
       } else window.location.reload();
     }
   } catch { setError("Something went wrong. Please try again."); }
   finally { setPending(false); }
 }
 async function resend() {
   setError(''); setNotice('');
   if (!email.trim()) { setError("First enter your email."); return; }
   setPending(true);
   try {
     const result = await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: '/' });
     if (result.error) setError(result.error.status === 429 ? 'Too many attempts. Please wait and try again.' : 'Could not send the verification email. Please try again.');
     else setNotice("If the account needs verification, you will receive an email.");
   } catch { setError("Could not send the verification email. Please try again."); }
   finally { setPending(false); }
 }
 if (mode === 'check-email' || mode === 'reset-requested') return <>
   <div className="access-heading"><span className="access-section-label">ACCOUNT</span><h1 id="access-title">Check your email</h1><p>{mode === 'check-email' ? "If the account was created, open the verification link you will receive by mail before log in." : "If there is an account with that mail, you will receive a link to change your password."}</p></div>
   {mode === 'check-email' && <button className="access-submit access-extra-action" type="button" disabled={pending} onClick={resend}>Resend verification email</button>}
   {notice && <p className="access-status" role="status">{notice}</p>}{error && <p className="access-error access-status" role="alert">{error}</p>}
   <div className="access-switch"><button type="button" onClick={() => changeMode('sign-in')}>Back to Log In</button></div>
 </>;
 return <>
 <div className="access-heading"><span className="access-section-label">ACCOUNT</span><h1 id="access-title">{register ? "Create an account" : mode === 'forgot' ? "Recover password" : "Log in"}</h1><p>{register ? "Enter your data to create an account." : mode === 'forgot' ? "Enter your email and we will send you a link to change your password." : "Enter your email and password to continue."}</p></div>
 <form className="access-form" onSubmit={submit}>
 {register && <label>Name<input autoComplete="name" required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>}
 <label>E-mail<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => { setEmail(e.target.value); if (needsVerification) { setNeedsVerification(false); setError(''); setNotice(''); } }} /></label>
 {mode !== 'forgot' && <div className="access-field">
   <label htmlFor="access-password">Password</label><div className="access-password-control">
     <input id="access-password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 12 : undefined} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} aria-describedby={register ? 'password-hint' : undefined} />
     <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
   </div>{register && <span id="password-hint" className="access-hint">At least 12 characters</span>}
 </div>}
 {register && <div className="access-field"><label htmlFor="access-confirm-password">Confirm password</label><div className="access-password-control">
   <input id="access-confirm-password" type={showConfirm ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} />
   <button type="button" onClick={() => setShowConfirm(!showConfirm)} aria-label={showConfirm ? "Hide password confirmation" : "Show password confirmation"} title={showConfirm ? "Hide password confirmation" : "Show password confirmation"}>{showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}</button>
 </div></div>}
 {mode === 'sign-in' && <button type="button" className="access-inline-action" onClick={() => changeMode('forgot')}>Forgot your password?</button>}
 {error && <p className="access-error" role="alert">{error}</p>}{notice && <p className="access-status" role="status">{notice}</p>}
 {needsVerification && <button className="access-inline-action access-verification-action" type="button" disabled={pending} onClick={resend}>Resend verification email</button>}
 <button className="access-submit" type="submit" disabled={pending}>{pending ? 'Please wait…' : register ? "Create an account" : mode === 'forgot' ? 'Send link' : "Log in"}</button>
 </form>
 <div className="access-switch"><span>{register ? "Already have an account?" : mode === 'forgot' ? '' : "Don't have an account?"}</span> <button type="button" onClick={() => changeMode(register || mode === 'forgot' ? 'sign-in' : 'register')}>{register || mode === 'forgot' ? "Log in" : "Create an account"}</button></div>
 </>;
}
