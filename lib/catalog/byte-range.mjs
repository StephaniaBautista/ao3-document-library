/**
 * Parse a single HTTP byte range. Unsupported or malformed ranges are ignored.
 * @param {string | null} header
 * @param {number} size
 * @returns {{ kind: 'full' } | { kind: 'unsatisfiable' } | { kind: 'range', start: number, end: number, length: number }}
 */
export function parseByteRange(header, size) {
 if (!header || !Number.isSafeInteger(size) || size < 0) return { kind: 'full' };
 const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
 if (!match || (!match[1] && !match[2])) return { kind: 'full' };
 const first = match[1] ? Number(match[1]) : null;
 const last = match[2] ? Number(match[2]) : null;
 if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return { kind: 'full' };
 if (first !== null && last !== null && last < first) return { kind: 'full' };
 if (size === 0 || (first !== null && first >= size) || (first === null && last === 0)) return { kind: 'unsatisfiable' };
 const start = first === null ? Math.max(0, size - last) : first;
 const end = first === null || last === null ? size - 1 : Math.min(last, size - 1);
 return { kind: 'range', start, end, length: end - start + 1 };
}
