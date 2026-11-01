export type OfflineEnvelope = { version: 1; salt: Uint8Array; iv: Uint8Array; ciphertext: ArrayBuffer };
export function sealOffline(value: unknown, password: string): Promise<OfflineEnvelope>;
export function openOffline(sealed: OfflineEnvelope, password: string): Promise<unknown>;
