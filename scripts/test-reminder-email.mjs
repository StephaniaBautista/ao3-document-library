// Explicit one-recipient smoke test. This never reads or changes saved reminders.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { sendMail, isMailConfigured } from '../lib/email-transport.ts';
import { formatRecoveryEmail } from '../lib/catalog/ao3-notifications.ts';

const recipient = process.argv[2];
if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
 console.error('Usage: node scripts/test-reminder-email.mjs recipient@example.com');
 process.exit(1);
}
const local = parseEnv(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'));
const env = { ...local, ...process.env };
if (!env.BREVO_API_KEY || !env.BREVO_FROM_EMAIL || !isMailConfigured(env)) {
 console.error('Configure BREVO_API_KEY and BREVO_FROM_EMAIL locally before running this test.');
 process.exit(1);
}
const rows = [
 { storyId: 'sample', title: 'Historia de ejemplo', ao3Url: 'https://archiveofourown.org/works/911652', action: 'kudo', comment: null },
 { storyId: 'sample', title: 'Historia de ejemplo', ao3Url: 'https://archiveofourown.org/works/911652', action: 'comment', comment: 'Este es un comentario de prueba para comprobar el correo.' },
];
const { text, html } = formatRecoveryEmail(rows);
const result = await sendMail(env, {
 to: recipient, subject: '[PRUEBA] AO3: tus recordatorios',
 text: 'ESTE ES UN CORREO DE PRUEBA. AO3 no necesariamente ha regresado.\n\n' + text,
 html: html.replace('<!-- TEST_NOTICE -->', '<p style="margin:0 0 24px;padding:12px 14px;background:#fff3da;border-left:3px solid #a66d1f;color:#5b441e;font:700 13px/20px Arial,sans-serif;">Correo de prueba: AO3 no necesariamente ha regresado.</p>'),
});
if (result !== 'accepted') { console.error(`Brevo did not confirm acceptance: ${result}. Do not retry an unknown result without checking provider logs.`); process.exit(1); }
console.log('Brevo accepted the test email. Check the destination inbox and Brevo delivery logs.');
