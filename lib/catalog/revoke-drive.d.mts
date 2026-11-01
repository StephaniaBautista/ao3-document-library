export function revokeDriveConnection(db: D1Database, userId: string, purpose: 'private' | 'admin', decrypt: (value: string) => Promise<string>, fetcher?: typeof fetch): Promise<void>;
