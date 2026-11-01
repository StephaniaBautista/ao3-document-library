'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
export default function VerifyEmail() {
 const [state, setState] = useState<'checking' | 'success' | 'invalid'>('checking'); const started = useRef(false);
 useEffect(() => {
   if (started.current) return; started.current = true;
   const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
   window.history.replaceState(null, '', window.location.pathname);
   // The fragment is available only after hydration.
   // eslint-disable-next-line react-hooks/set-state-in-effect
   if (!token) { setState('invalid'); return; }
   void fetch('/api/verify-email', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token})}).then(result => setState(result.ok ? 'success' : 'invalid')).catch(() => setState('invalid'));
 }, []);
 return <><div className="access-heading"><span className="access-section-label">ACCOUNT</span><h1 id="access-title">{state === 'checking' ? "Verifying email" : state === 'success' ? "Email verified" : 'Link unavailable'}</h1><p role="status">{state === 'checking' ? 'Please wait…' : state === 'success' ? "Your email has been verified. You can now sign in." : "The link is not valid or expired. Request another email from the login screen."}</p></div>{state !== 'checking' && <div className="access-switch"><Link href="/">Back to Log In</Link></div>}</>;
}
