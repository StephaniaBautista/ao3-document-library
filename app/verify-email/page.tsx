import type { Metadata } from 'next';
import AccessLayout from '../access-layout';
import VerifyEmail from './verify-email';
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } };
export default function VerifyEmailPage() {
  return <AccessLayout><VerifyEmail /></AccessLayout>;
}
