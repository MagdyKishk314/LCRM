import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';

let transporter: Transporter | null = null;

/**
 * Lazily built SMTP transport.
 *
 * With no SMTP host configured, mail is logged instead of sent — so a dev machine
 * or a fresh VPS can exercise the whole send path without a mail account, and without
 * accidentally emailing a real land owner from a test database.
 */
function getTransport(): Transporter | null {
  if (transporter) return transporter;
  if (!env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: (env.SMTP_PORT ?? 587) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });

  return transporter;
}

/** Whether mail is genuinely sent, or only logged. */
export function smtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST);
}

export interface SendMailInput {
  from: string;
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(input: SendMailInput): Promise<void> {
  const transport = getTransport();

  if (!transport) {
    console.log('[email] SMTP not configured — logging instead of sending');
    console.log(`  to: ${input.to.join(', ')}`);
    console.log(`  subject: ${input.subject}`);
    return;
  }

  await transport.sendMail(input);
}
