import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/offline-topbar.js', import.meta.url), 'utf8');

test('offline theme and palette changes are saved for the connected library', () => {
 const values = new Map([['library-light-appearance', 'warm']]);
 const toggle = { addEventListener(_type, fn) { this.click = fn; }, setAttribute(name, value) { this[name] = value; } };
 const inputs = ['original', 'forest'].map(value => ({ value, addEventListener(_type, fn) { this.change = fn; } }));
 const document = { documentElement: { dataset: { theme: 'light', palette: 'original' } }, getElementById() { return toggle; }, querySelectorAll() { return inputs; } };
 const localStorage = { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } };
 vm.runInNewContext(source, { document, localStorage, window: { location: { pathname: '/offline' } } });
 toggle.click();
 assert.equal(document.documentElement.dataset.theme, 'dark');
 assert.equal(values.get('library-pending-appearance'), 'night');
 inputs[1].checked = true; inputs[1].change();
 assert.equal(document.documentElement.dataset.palette, 'forest');
 assert.equal(values.get('library-pending-palette'), 'forest');
 assert.deepEqual(JSON.parse(values.get('biblioteca-offline-appearance')), { appearance: 'night', colorPalette: 'forest' });
 toggle.click();
 assert.equal(values.get('library-pending-appearance'), 'warm');
 assert.equal(toggle['aria-label'], 'Dark mode');
});

test('older offline HTML addresses are replaced with the application route', () => {
 let destination;
 const document = { documentElement: { dataset: {} }, getElementById() { return { addEventListener() {}, setAttribute() {} }; }, querySelectorAll() { return []; } };
 const window = { location: { pathname: '/offline.html', search: '?x=1', hash: '#saved' } };
 const history = { state: null, replaceState(_state, _title, url) { destination = url; } };
 vm.runInNewContext(source, { document, window, history, localStorage: { getItem() { return null; }, setItem() {} } });
 assert.equal(destination, '/offline?x=1#saved');
});
