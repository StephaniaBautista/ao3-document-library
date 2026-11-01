import { env } from 'cloudflare:workers';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb } from '@/db';
import * as schema from '@/db/schema';
import { sendAccountEmail } from './mail';
import { decryptToken } from './catalog/drive';
import { revokeDriveConnection } from './catalog/revoke-drive.mjs';
import { requestIdentityRedaction } from './catalog/identity-redaction';

export function getAuth() {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32 || !env.BETTER_AUTH_URL) {
    throw new Error('Configure BETTER_AUTH_SECRET and BETTER_AUTH_URL in .dev.vars.');
  }
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(getDb(), { provider: 'sqlite', schema, transaction: false }),
    user: {
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          if (!env.DB || !env.BUCKET) throw new Error('Account deletion unavailable');
          const profile = await env.DB.prepare('SELECT age_verification_id AS verificationId FROM library_profiles WHERE user_id = ?').bind(user.id).first<{ verificationId: string | null }>();
          if (profile?.verificationId) {
            await requestIdentityRedaction(env.STRIPE_IDENTITY_SECRET_KEY || '', profile.verificationId, user.id);
          }
          await revokeDriveConnection(env.DB, user.id, 'private', decryptToken);
          await revokeDriveConnection(env.DB, user.id, 'admin', decryptToken);
          const legacy = await env.DB.prepare('SELECT object_key AS objectKey FROM files WHERE owner = ?').bind(user.id).all<{ objectKey: string }>();
          for (let offset = 0; offset < legacy.results.length; offset += 100) await env.BUCKET.delete(legacy.results.slice(offset, offset + 100).map(row => row.objectKey));
          await env.DB.batch([
            env.DB.prepare('DELETE FROM files WHERE owner = ?').bind(user.id),
            env.DB.prepare('DELETE FROM folders WHERE owner = ?').bind(user.id),
            env.DB.prepare('DELETE FROM verification WHERE value = ?').bind(user.id),
          ]);
        },
      },
    },
    emailAndPassword: {
      enabled: true, minPasswordLength: 12, maxPasswordLength: 128, requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 3600, revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        const url = new URL('/reset-password', env.BETTER_AUTH_URL); url.hash = new URLSearchParams({ token }).toString();
        // Keep the public response identical for existing and unknown email addresses.
        try { await sendAccountEmail(user.email, url.toString(), 'reset'); }
        catch { console.error('Could not send a password reset email'); }
      },
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: false, autoSignInAfterVerification: false, expiresIn: 3600,
      sendVerificationEmail: async ({ user, token }) => {
        const url = new URL('/verify-email', env.BETTER_AUTH_URL); url.hash = new URLSearchParams({ token }).toString();
        await sendAccountEmail(user.email, url.toString(), 'verify');
      },
    },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 10 }, '/sign-up/email': { window: 60, max: 10 }, '/request-password-reset': { window: 60, max: 5 }, '/send-verification-email': { window: 60, max: 5 }, '/verify-email': { window: 60, max: 15 } } },
  });
}
