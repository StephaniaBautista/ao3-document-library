type IdentityResponse = {
 id?: unknown;
 type?: unknown;
 client_reference_id?: unknown;
 status?: unknown;
 redaction?: { status?: unknown } | null;
};

/** Request provider-side deletion before removing the account's link to it. */
export async function requestIdentityRedaction(secret: string, verificationId: string, userId: string) {
 if (!secret || !/^vs_[A-Za-z0-9]+$/.test(verificationId)) throw new Error('Identity data deletion unavailable');
 const endpoint = `https://api.stripe.com/v1/identity/verification_sessions/${encodeURIComponent(verificationId)}`;
 const headers = { Authorization: `Bearer ${secret}` };
 const current = await fetch(endpoint, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
 if (!current.ok) throw new Error('Identity data deletion unavailable');
 const session = await current.json() as IdentityResponse;
 if (session.id !== verificationId) throw new Error('Identity data deletion unavailable');
 if (session.redaction?.status === 'processing' || session.redaction?.status === 'redacted') return;
 if (session.type !== 'document' || session.client_reference_id !== userId || session.redaction) throw new Error('Identity data deletion unavailable');
 // Stripe documents redaction for requires_input and verified sessions. Do not
 // discard our only reference when a canceled session needs provider support.
 if (session.status !== 'requires_input' && session.status !== 'verified') throw new Error('Identity data deletion unavailable');
 const result = await fetch(`${endpoint}/redact`, { method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
 if (!result.ok) throw new Error('Identity data deletion unavailable');
 const redacted = await result.json() as IdentityResponse;
 if (redacted.id !== verificationId || !['processing', 'redacted'].includes(String(redacted.redaction?.status))) throw new Error('Identity data deletion unavailable');
}
