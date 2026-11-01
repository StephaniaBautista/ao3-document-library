export function splitTranslationText(text) {
 const chunks = [];
 let remaining = text.trim();
 while (remaining.length > 4500) {
  let end = remaining.lastIndexOf(' ', 4500);
  if (end < 2000) end = 4500;
  // Keep UTF-16 surrogate pairs intact when no whitespace is available.
  if (end > 0 && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
  chunks.push(remaining.slice(0, end));
  remaining = remaining.slice(end).trimStart();
 }
 if (remaining) chunks.push(remaining);
 return chunks;
}

