/**
 * SMTP transport (Nodemailer; MailHog in dev). Infra-only: sends bytes, decides
 * nothing. Credentials come from typed config; the password is never logged.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const transporter: Transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  ...(env.SMTP_USER !== undefined && env.SMTP_PASS !== undefined
    ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
    : {}),
});

export const emailClient = {
  async send(message: EmailMessage): Promise<void> {
    await transporter.sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html !== undefined ? { html: message.html } : {}),
    });
  },

  /** Health probe: verifies the SMTP connection/credentials. */
  async verify(): Promise<void> {
    await transporter.verify();
  },
};

export type EmailClient = typeof emailClient;
