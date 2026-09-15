import 'dotenv/config';
import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.OTP_FROM_EMAIL || process.env.SMTP_FROM_EMAIL;

if (!host || !user || !pass || !from) {
  console.error('SMTP CHECK FAIL: Missing SMTP_HOST/SMTP_USER/SMTP_PASS/OTP_FROM_EMAIL.');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host, port, secure,
  auth: { user, pass },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});

try {
  await transporter.verify();
  console.log(`SMTP CHECK PASS: authenticated to ${host}:${port} as ${user}; sender=${from}`);
} catch (error) {
  console.error('SMTP CHECK FAIL');
  console.error('code:', error?.code || 'n/a');
  console.error('responseCode:', error?.responseCode || 'n/a');
  console.error('response:', error?.response || error?.message || 'unknown SMTP error');
  process.exit(1);
}
