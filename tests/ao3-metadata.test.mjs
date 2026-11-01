import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAo3Header } from '../lib/catalog/metadata.mjs';

test('extracts the original summary and AO3 metadata without inventing content', () => {
 const result = parseAo3Header(`Example\nPosted originally on the Archive of Our Own at http://archiveofourown.org/works/39224178.\nRating: Teen\nArchive Warning: No Archive Warnings Apply\nFandom: Supergirl\nRelationship: Kara/Lena\nAdditional Tags: Friends to Lovers\nLanguage: English\nStats: Words: 1000\nExample\nby ExampleAuthor\nSummary\nThe author’s own summary.\nNotes\nNot part of the summary.`);
 assert.equal(result.ao3Url, 'https://archiveofourown.org/works/39224178');
 assert.equal(result.fandom, 'Supergirl');
 assert.equal(result.relationship, 'Kara/Lena');
 assert.equal(result.summary, 'The author’s own summary.');
 assert.equal(result.author, 'ExampleAuthor');
 assert.equal(parseAo3Header('A document with no summary').summary, undefined);
});
