import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetPasswordEmail, verificationEmail } from '../lib/verification-email.ts';

test('verification email retains an escaped action link and a usable plain-text alternative', () => {
 const url = 'https://library.example/verify-email#token=abc&next=%22test%22';
 const message = verificationEmail(url);
 assert.equal(message.subject, 'Verify your email address');
 assert.ok(message.text.includes(url));
 assert.match(message.text, /expires in one hour/i);
 assert.ok(message.html.includes('href="https://library.example/verify-email#token=abc&amp;next=%22test%22"'));
 assert.match(message.html, /Verify email address/);
 assert.match(message.html, /expires in one hour/i);
 assert.match(message.html, /ignore this email/i);
});

test('verification link is escaped before being placed in HTML', () => {
 const message = verificationEmail('https://example.test/"<>&\'');
 assert.ok(message.html.includes('href="https://example.test/&quot;&lt;&gt;&amp;&#39;"'));
});

test('password recovery email has its own action, escaped link and plain-text alternative', () => {
 const url = 'https://library.example/reset-password#token=abc&next=%22test%22';
 const message = resetPasswordEmail(url);
 assert.equal(message.subject, 'Reset your password');
 assert.ok(message.text.includes(url));
 assert.match(message.text, /expires in one hour/i);
 assert.ok(message.html.includes('href="https://library.example/reset-password#token=abc&amp;next=%22test%22"'));
 assert.match(message.html, /Reset password/);
 assert.match(message.html, /expires in one hour/i);
 assert.match(message.html, /ignore this email/i);
 assert.doesNotMatch(message.html, /Verify email address/);
});
