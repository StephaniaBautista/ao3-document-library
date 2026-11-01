import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueExtractorTicket, verifyExtractorTicket } from '../lib/catalog/extractor-ticket.ts';

test('extractor tickets are scoped to one story and expire', async () => {
 const secret = 'synthetic-extractor-secret-123456789';
 const ticket = await issueExtractorTicket('story-1', secret, 3000);
 assert.equal(await verifyExtractorTicket(ticket, 'story-1', secret, 2000), true);
 assert.equal(await verifyExtractorTicket(ticket, 'story-2', secret, 2000), false);
 assert.equal(await verifyExtractorTicket(ticket, 'story-1', secret, 3000), false);
 assert.equal(await verifyExtractorTicket(`${ticket.slice(0, -1)}!`, 'story-1', secret, 2000), false);
 assert.equal(await verifyExtractorTicket(ticket, 'story-1', 'other-synthetic-secret-123456789012', 2000), false);
});
