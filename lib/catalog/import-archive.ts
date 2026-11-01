import { BlobReader, ZipReader, type FileEntry } from '@zip.js/zip.js';

const maxEntry = 50 * 1024 * 1024;
const maxExpanded = 20 * 1024 * 1024 * 1024;
const maxEntries = 50000;
const supported = /\.(pdf|epub|html?)$/i;

export type ImportItem = { name: string; path?: string; read: () => Promise<File> };
export type ImportPlan = { items: ImportItem[]; skipped: string[]; close: () => Promise<void> };

/** Index archives without loading their contents; unpack only the item being imported. */
export async function prepareImport(files: File[], onArchive?: (name: string) => void): Promise<ImportPlan> {
 const items: ImportItem[] = [], skipped: string[] = [];
 const readers: ZipReader<Blob>[] = [];
 let expanded = 0, entryCount = 0;
 try {
  for (const file of files) {
   if (!/\.zip$/i.test(file.name)) {
    if (!supported.test(file.name)) skipped.push(`${file.name}: unsupported format`);
    else if (file.size > maxEntry) skipped.push(`${file.name}: exceeds the current 50 MB per-file limit`);
    else items.push({ name: file.name, read: async () => file });
    continue;
   }
   onArchive?.(file.name);
   const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
   readers.push(reader);
   let entries;
   try { entries = await reader.getEntries(); }
   catch { skipped.push(`${file.name}: could not open the ZIP`); continue; }
   entryCount += entries.length;
   if (entryCount > maxEntries) throw new Error("The selection contains more than 50,000 entries. Split it into multiple uploads.");
   for (const entry of entries) {
    if (entry.directory) continue;
    const path = entry.filename.replace(/\\/g, '/');
    if (!supported.test(path) || path.startsWith('__MACOSX/') || path.split('/').some(part => part.startsWith('.'))) continue;
    const name = path.split('/').pop() || 'archivo';
    if (entry.encrypted) { skipped.push(`${name}: password-protected file`); continue; }
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > maxEntry) { skipped.push(`${name}: exceeds the current 50 MB per-file limit`); continue; }
    expanded += entry.uncompressedSize;
    if (expanded > maxExpanded) throw new Error("The selection exceeds 20 GB of uncompressed content. Split it into multiple uploads.");
    items.push({ name, path, read: () => readEntry(entry, name) });
   }
  }
  return { items, skipped, close: async () => { await Promise.all(readers.map(reader => reader.close())); } };
 } catch (cause) {
  await Promise.all(readers.map(reader => reader.close()));
  throw cause;
 }
}

async function readEntry(entry: FileEntry, name: string): Promise<File> {
 const chunks: Uint8Array[] = [];
 let size = 0;
 const sink = new WritableStream<Uint8Array>({ write(chunk) {
  size += chunk.byteLength;
  if (size > maxEntry || size > entry.uncompressedSize) throw new Error("The file exceeds its declared or permitted size.");
  chunks.push(chunk);
 } });
 await entry.getData(sink, { checkCrc32: true, checkLocalDirectory: true });
 if (size !== entry.uncompressedSize) throw new Error("The file is incomplete.");
 return new File(chunks as BlobPart[], name);
}
