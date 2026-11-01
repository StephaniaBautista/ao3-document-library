export function newCodeVerifier(): string;
export function codeChallenge(verifier: string): Promise<string>;
