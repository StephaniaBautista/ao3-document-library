export const contentSecurityPolicy: string;
export const securityHeaders: Record<string, string>;
export function secureResponse(response: Response, url: string): Response;
