/** Private, incomplete work stays separate from the finished offline library. */
import type { OfflineEnvelope } from '../../public/offline-vault.mjs';
export type OfflinePreparation<T> = { id: string; updatedAt: number; fingerprint: string; pages: T[]; total: number; bytes: number };
type StoredPreparation<T> = OfflinePreparation<T> | { id: string; sealed: OfflineEnvelope };

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
 const db = await new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('biblioteca-offline-preparation-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('jobs', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
 });
 try {
  return await new Promise<T>((resolve, reject) => {
   const transaction = db.transaction('jobs', mode), request = action(transaction.objectStore('jobs'));
   transaction.oncomplete = () => resolve(request.result);
   transaction.onerror = () => reject(transaction.error);
   transaction.onabort = () => reject(transaction.error);
  });
 } finally { db.close(); }
}
export async function loadOfflinePreparation<T>(id: string): Promise<OfflinePreparation<T> | undefined> {
 const stored = await withStore<StoredPreparation<T> | undefined>('readonly', store => store.get(id));
 if (stored && 'sealed' in stored) throw new Error('This preparation is encrypted and cannot be resumed without its original password.');
 return stored;
}
export async function saveOfflinePreparation<T>(job: OfflinePreparation<T>): Promise<void> {
 await withStore('readwrite', store => store.put({ ...job, updatedAt: Date.now() }));
}
export async function deleteOfflinePreparation(id: string): Promise<void> {
 await withStore('readwrite', store => store.delete(id));
}
