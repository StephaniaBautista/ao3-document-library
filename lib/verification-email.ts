// Email clients need inline styles, so these are the email-safe equivalents of
// the library's cool canvas, ink, and blue accent tokens.
const colors = {
  canvas: '#f1f5f9',
  surface: '#ffffff',
  ink: '#203044',
  muted: '#526479',
  accent: '#2365ac',
  dark: '#1e3048',
  border: '#dce5ee',
};
const font = "'Avenir Next', 'Segoe UI', Arial, sans-serif";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function accountEmail(url: string, purpose: 'verify' | 'reset') {
  const verify = purpose === 'verify';
  const subject = verify ? 'Verify your email address' : 'Reset your password';
  const label = verify ? 'ACCOUNT VERIFICATION' : 'PASSWORD RECOVERY';
  const heading = verify ? 'Verify your<br>email address.' : 'Reset your<br>password.';
  const sentence = verify ? 'Confirm your email address to finish setting up your account.' : 'Use this link to choose a new password for your account.';
  const action = verify ? 'Verify email address' : 'Reset password';
  const text = `${sentence}\n\n${action}: ${url}\n\nThis link expires in one hour. If you did not request this, you can ignore this email.`;
  const link = escapeHtml(url);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:${colors.canvas};font-family:${font};color:${colors.ink};">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${sentence}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${colors.canvas};"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:${colors.surface};border:1px solid ${colors.border};">
      <tr><td style="height:6px;background-color:${colors.dark};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:40px 32px 36px;">
        <p style="margin:0 0 22px;color:${colors.accent};font-family:${font};font-size:11px;font-weight:700;letter-spacing:1.5px;line-height:16px;">${label}</p>
        <h1 style="margin:0;color:${colors.ink};font-family:${font};font-size:32px;font-weight:700;letter-spacing:-1px;line-height:1.2;">${heading}</h1>
        <p style="margin:20px 0 28px;color:${colors.muted};font-family:${font};font-size:16px;line-height:26px;">${sentence}</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${colors.accent}" style="border-radius:4px;"><a href="${link}" style="display:inline-block;padding:15px 24px;color:#ffffff;font-family:${font};font-size:14px;font-weight:700;line-height:20px;text-decoration:none;">${action} &nbsp;&rarr;</a></td></tr></table>
        <p style="margin:28px 0 0;color:${colors.muted};font-family:${font};font-size:13px;line-height:21px;">This link expires in one hour.</p>
      </td></tr>
      <tr><td style="padding:0 32px;"><div style="border-top:1px solid ${colors.border};font-size:0;line-height:0;">&nbsp;</div></td></tr>
      <tr><td style="padding:22px 32px 28px;color:${colors.muted};font-family:${font};font-size:13px;line-height:21px;">If you didn’t request this, you can safely ignore this email.</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, text, html };
}

export function verificationEmail(url: string) {
  return accountEmail(url, 'verify');
}

export function resetPasswordEmail(url: string) {
  return accountEmail(url, 'reset');
}
