import test from 'node:test';
import assert from 'node:assert/strict';
import { splitForTranslation, groupLayoutSpans, distributeTranslation, needsTranslation } from '../lib/catalog/offline-translation.mjs';

test('preserves separator symbols and numbers instead of sending them to the translation model', () => {
 assert.equal(needsTranslation('*************'), false);
 assert.equal(needsTranslation('— 123 —'), false);
 assert.equal(needsTranslation('Chapter 3'), true);
});

test('splits long source text without losing words or breaking surrogate pairs', () => {
 const text = `${'word '.repeat(100)}😀${'long'.repeat(150)}`;
 const parts = splitForTranslation(text);
 assert.ok(parts.every(part => part.length <= 360 && !/[\uD800-\uDBFF]$/.test(part)));
 assert.equal(parts.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
});

test('groups continuing lines but keeps columns and different styles separate', () => {
 const spans = [
  {text:'A sentence',left:20,top:10,width:80,height:10,font:'serif'},
  {text:'continues.',left:20,top:22,width:80,height:10,font:'serif'},
  {text:'Other column',left:200,top:10,width:80,height:10,font:'serif'},
  {text:'Heading',left:20,top:40,width:80,height:15,font:'bold'},
 ];
 assert.deepEqual(groupLayoutSpans(spans).map(group => group.indices), [[0,1],[2],[3]]);
});

test('keeps every translated word when it occupies more or fewer lines', () => {
 const spans = [{text:'First',width:40},{text:'Second',width:40},{text:'Third',width:40}];
 for (const text of ['Una traducción mucho más larga que el original', 'Hola mundo', 'Una']) {
  const lines = distributeTranslation(text,[0,1,2],spans);
  assert.equal(lines.length,3);
  assert.equal(lines.join(' ').trim().replace(/\s+/g,' '),text);
 }
});
