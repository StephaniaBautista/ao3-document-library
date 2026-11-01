/** Preserve ornaments, page numbers and separators exactly as written. */
export function needsTranslation(text) { return /\p{L}/u.test(text); }

/** Split text without losing characters or breaking UTF-16 surrogate pairs. */
export function splitForTranslation(text, max = 360) {
 const chunks = []; let remaining = text.trim();
 while (remaining.length > max) {
  let end = remaining.lastIndexOf(' ', max);
  if (end < max / 2) end = max;
  if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
  chunks.push(remaining.slice(0, end)); remaining = remaining.slice(end).trimStart();
 }
 if (remaining) chunks.push(remaining);
 return chunks;
}

/** Form short, sequential line groups without mixing columns or font styles. */
export function groupLayoutSpans(spans) {
 const groups = [];
 for (let index = 0; index < spans.length; index++) {
  const span = spans[index];
  if (!span.text.trim()) continue;
  const prev = groups.at(-1), last = prev && spans[prev.indices.at(-1)];
  const near = last && span.top > last.top && span.top - last.top <= Math.max(span.height, last.height) * 1.9 && Math.abs(span.left - last.left) <= Math.max(span.height, last.height) * 1.5;
  const sameStyle = last && span.font === last.font && Math.abs(span.height - last.height) <= last.height * .2;
  if (prev && near && sameStyle && !/[.!?。！？]["'”’)]?\s*$/.test(last.text) && prev.text.length + span.text.length < 360) {
   prev.indices.push(index); prev.text += ` ${span.text.trim()}`;
  } else groups.push({ indices: [index], text: span.text.trim() });
 }
 return groups;
}

/** Distribute every translated word across the original lines. */
export function distributeTranslation(text, indices, spans) {
 const words = text.trim().split(/\s+/u).filter(Boolean);
 const weights = indices.map(index => Math.max(1, spans[index].width || spans[index].text.length));
 const output = indices.map(() => ''); let word = 0;
 for (let i = 0; i < indices.length; i++) {
  if (i === indices.length - 1) { output[i] = words.slice(word).join(' '); break; }
  const remainingWeight = weights.slice(i).reduce((a, b) => a + b, 0);
  const remainingText = words.slice(word).join(' '), limit = remainingText.length * weights[i] / remainingWeight;
  while (word < words.length && (!output[i] || output[i].length + 1 + words[word].length <= limit)) {
   output[i] += (output[i] ? ' ' : '') + words[word++];
  }
 }
 return output;
}
