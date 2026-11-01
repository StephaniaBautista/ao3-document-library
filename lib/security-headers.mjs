export const contentSecurityPolicy = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:";
export const securityHeaders = {
 'Content-Security-Policy': contentSecurityPolicy,
 'X-Frame-Options': 'DENY',
 'X-Content-Type-Options': 'nosniff',
 'Referrer-Policy': 'strict-origin-when-cross-origin',
 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function secureResponse(response, url) {
 const headers = new Headers(response.headers);
 const defaults = { ...securityHeaders };
 if (new URL(url).protocol === 'https:') defaults['Strict-Transport-Security'] = 'max-age=31536000';
 // More restrictive route-specific policies, such as sandboxed documents, take precedence.
 for (const [name, value] of Object.entries(defaults)) if (!headers.has(name)) headers.set(name, value);
 return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
