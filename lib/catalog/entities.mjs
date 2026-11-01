const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeTextEntities(text) {
 return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
  if (entity[0] !== '#') return entities[entity.toLowerCase()] || match;
  const hex = entity[1]?.toLowerCase() === 'x';
  const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
 });
}
