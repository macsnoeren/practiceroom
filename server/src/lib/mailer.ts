import nodemailer, { type Transporter } from 'nodemailer';
import { appUrl, env, mailEnabled, mailFrom, smtpSecure } from '../env.js';

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * In the test environment, every "sent" message is also recorded here so tests
 * can assert on it (and recover the token from the link). Never populated in
 * development or production.
 */
export const outbox: Mail[] = [];

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: smtpSecure, // true for 465 (TLS), false for 587 (STARTTLS)
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  return transporter;
}

/**
 * Sends an e-mail, or — when no SMTP host is configured — logs what it would
 * have sent so local development and tests work without a mail server.
 */
async function sendMail(mail: Mail): Promise<void> {
  if (env.NODE_ENV === 'test') {
    outbox.push(mail);
    return;
  }
  if (!mailEnabled) {
    console.info(`[mail disabled] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    return;
  }
  await getTransporter().sendMail({
    from: mailFrom,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

function actionLink(path: string, token: string): string {
  return `${appUrl}${path}?token=${encodeURIComponent(token)}`;
}

/** Wraps body lines in a minimal, client-safe HTML shell. */
function layout(title: string, lines: string[], cta?: { label: string; url: string }): string {
  const paragraphs = lines.map((l) => `<p>${l}</p>`).join('');
  const button = cta
    ? `<p><a href="${cta.url}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none">${cta.label}</a></p>`
    : '';
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
  <h2 style="color:#4f46e5">${title}</h2>${paragraphs}${button}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
  <p style="font-size:12px;color:#6b7280">PracticeRoom</p>
</div>`;
}

export async function sendVerificationEmail(
  to: string,
  name: string,
  token: string,
): Promise<void> {
  const url = actionLink('/verify-email', token);
  await sendMail({
    to,
    subject: 'Bevestig je e-mailadres — PracticeRoom',
    text: `Hallo ${name},\n\nBevestig je e-mailadres voor PracticeRoom via deze link:\n${url}\n\nDeze link is 24 uur geldig.`,
    html: layout(
      'Bevestig je e-mailadres',
      [
        `Hallo ${name},`,
        'Klik op de knop hieronder om je e-mailadres te bevestigen. Deze link is 24 uur geldig.',
      ],
      { label: 'E-mailadres bevestigen', url },
    ),
  });
}

export async function sendInviteEmail(to: string, name: string, token: string): Promise<void> {
  const url = actionLink('/accept-invite', token);
  await sendMail({
    to,
    subject: 'Je bent uitgenodigd voor PracticeRoom',
    text: `Hallo ${name},\n\nEr is een account voor je aangemaakt in PracticeRoom. Kies een wachtwoord via deze link:\n${url}\n\nDeze link is 7 dagen geldig.`,
    html: layout(
      'Welkom bij PracticeRoom',
      [
        `Hallo ${name},`,
        'Er is een account voor je aangemaakt. Kies een wachtwoord om je account te activeren. Deze link is 7 dagen geldig.',
      ],
      { label: 'Wachtwoord instellen', url },
    ),
  });
}

/** Tells an existing account holder they were added to another school. They use
 * their existing login; no action is required. */
export async function sendAddedToSchoolEmail(
  to: string,
  name: string,
  schoolName: string,
): Promise<void> {
  const url = appUrl;
  await sendMail({
    to,
    subject: `Je bent toegevoegd aan ${schoolName} — PracticeRoom`,
    text: `Hallo ${name},\n\nJe bent toegevoegd aan ${schoolName} in PracticeRoom. Log in met je bestaande account; bovenin kun je tussen je scholen wisselen.\n${url}`,
    html: layout(
      'Toegevoegd aan een school',
      [
        `Hallo ${name},`,
        `Je bent toegevoegd aan <strong>${schoolName}</strong>. Log in met je bestaande account; bovenin de app kun je tussen je scholen wisselen.`,
      ],
      { label: 'Naar PracticeRoom', url },
    ),
  });
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  token: string,
): Promise<void> {
  const url = actionLink('/reset-password', token);
  await sendMail({
    to,
    subject: 'Wachtwoord opnieuw instellen — PracticeRoom',
    text: `Hallo ${name},\n\nJe hebt gevraagd om je wachtwoord opnieuw in te stellen. Gebruik deze link:\n${url}\n\nDeze link is 1 uur geldig. Heb je dit niet aangevraagd? Negeer dan deze e-mail.`,
    html: layout(
      'Wachtwoord opnieuw instellen',
      [
        `Hallo ${name},`,
        'Je hebt gevraagd om je wachtwoord opnieuw in te stellen. Deze link is 1 uur geldig.',
        'Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren.',
      ],
      { label: 'Nieuw wachtwoord kiezen', url },
    ),
  });
}
