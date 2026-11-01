import type { Metadata } from 'next';
import AccessLayout from '../access-layout';
import ResetPassword from './reset-password';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } };
export default function ResetPasswordPage() {
  return <AccessLayout><ResetPassword /></AccessLayout>;
}
