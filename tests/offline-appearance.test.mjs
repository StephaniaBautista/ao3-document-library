import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/offline-appearance.js', import.meta.url), 'utf8');

function appearance(value, unavailable = false) {
 const document = { documentElement: { dataset: {} } };
 const localStorage = { getItem() { if (unavailable) throw new Error('unavailable'); return value; } };
 vm.runInNewContext(source, { document, localStorage });
 return { ...document.documentElement.dataset };
}

test('offline appearance preserves the saved theme and palette', () => {
 assert.deepEqual(appearance('{"appearance":"night","colorPalette":"forest"}'), { theme: 'dark', palette: 'forest' });
 assert.deepEqual(appearance('{"appearance":"blue","colorPalette":"ocean"}'), { theme: 'light', palette: 'ocean' });
});

test('offline appearance handles invalid or inaccessible preferences', () => {
 assert.deepEqual(appearance('{'), { theme: 'light', palette: 'original' });
 assert.deepEqual(appearance(null, true), { theme: 'light', palette: 'original' });
 assert.deepEqual(appearance('{"appearance":"night","colorPalette":"unknown"}'), { theme: 'dark', palette: 'original' });
});

test('offline color palettes match the connected library', async () => {
 const connected = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
 const offline = await readFile(new URL('../public/offline.css', import.meta.url), 'utf8');
 const connectedPalettes = connected.slice(connected.indexOf('/* Personal color palettes'), connected.indexOf('.folio-palette-picker'));
 const variables = block => Object.fromEntries([...block.matchAll(/(--f-[\w-]+)\s*:\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
 for (const theme of ['light', 'dark']) for (const palette of ['ocean', 'forest', 'lavender', 'rose', 'slate']) {
  const selector = theme === 'dark' ? `[data-theme='dark'][data-palette='${palette}']` : `[data-palette='${palette}']`;
  const connectedStart = connectedPalettes.indexOf(`.folio-app${selector}`);
  const offlineStart = offline.indexOf(`:root${selector}`);
  assert.notEqual(connectedStart, -1, selector);
  assert.notEqual(offlineStart, -1, selector);
  assert.deepEqual(variables(offline.slice(offline.indexOf('{', offlineStart), offline.indexOf('}', offlineStart))), variables(connectedPalettes.slice(connectedPalettes.indexOf('{', connectedStart), connectedPalettes.indexOf('}', connectedStart))));
 }
});
