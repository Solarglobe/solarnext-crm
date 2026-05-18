import nodemailer from "nodemailer";
import logger from "../app/core/logger.js";

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function appBaseUrl() {
  return env("APP_BASE_URL") || env("FRONTEND_URL") || env("PUBLIC_APP_URL") || "https://app.solarnext.fr";
}

function smtpConfig() {
  const host = env("SMTP_HOST");
  const port = Number(env("SMTP_PORT", "587"));
  const user = env("SMTP_USER");
  const pass = env("SMTP_PASS");
  const from = env("AUTH_MAIL_FROM") || env("SMTP_FROM") || user;
  if (!host || !port || !from) return null;
  return {
    host,
    port,
    secure: env("SMTP_SECURE").toLowerCase() === "true" || port === 465,
    auth: user && pass ? { user, pass } : undefined,
    from,
  };
}

async function sendSystemMail({ to, subject, text, html }) {
  const config = smtpConfig();
  if (!config) {
    logger.warn("AUTH_MAIL_SKIPPED_SMTP_NOT_CONFIGURED", { to, subject });
    return { skipped: true };
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
  });
  try {
    const info = await transport.sendMail({
      from: config.from,
      to,
      subject,
      text,
      html,
    });
    return { skipped: false, messageId: info.messageId ?? null };
  } finally {
    transport.close();
  }
}

function shellHtml(content) {
  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#f6f3ef;padding:32px;color:#1f2933">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e8dfd2;border-radius:8px;padding:28px">
        <div style="font-size:20px;font-weight:700;color:#2e1a47;margin-bottom:18px">SolarNext</div>
        ${content}
      </div>
    </div>
  `;
}

export async function sendPasswordResetEmail({ to, token }) {
  const resetUrl = `${appBaseUrl().replace(/\/+$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  return sendSystemMail({
    to,
    subject: "Reinitialisation de votre mot de passe SolarNext",
    text: `Vous avez demande la reinitialisation de votre mot de passe SolarNext. Ouvrez ce lien dans l'heure : ${resetUrl}`,
    html: shellHtml(`
      <p style="margin:0 0 16px">Vous avez demande la reinitialisation de votre mot de passe SolarNext.</p>
      <p style="margin:0 0 22px">Ce lien est valable 1 heure et ne peut etre utilise qu'une seule fois.</p>
      <p style="margin:0 0 22px">
        <a href="${resetUrl}" style="display:inline-block;background:#2e1a47;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700">Reinitialiser mon mot de passe</a>
      </p>
      <p style="margin:0;color:#64748b;font-size:13px">Si vous n'etes pas a l'origine de cette demande, ignorez cet email.</p>
    `),
  });
}

export async function sendPasswordChangedEmail({ to }) {
  return sendSystemMail({
    to,
    subject: "Votre mot de passe SolarNext a ete modifie",
    text: "Votre mot de passe SolarNext vient d'etre modifie. Si vous n'etes pas a l'origine de cette action, contactez immediatement votre administrateur.",
    html: shellHtml(`
      <p style="margin:0 0 16px">Votre mot de passe SolarNext vient d'etre modifie.</p>
      <p style="margin:0;color:#64748b;font-size:13px">Si vous n'etes pas a l'origine de cette action, contactez immediatement votre administrateur.</p>
    `),
  });
}

export async function sendEmailVerificationEmail({ to, token }) {
  const verifyUrl = `${appBaseUrl().replace(/\/+$/, "")}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  return sendSystemMail({
    to,
    subject: "Confirmez votre email SolarNext",
    text: `Confirmez votre adresse email SolarNext dans les 24 heures : ${verifyUrl}`,
    html: shellHtml(`
      <p style="margin:0 0 16px">Bienvenue sur SolarNext.</p>
      <p style="margin:0 0 22px">Confirmez votre adresse email pour debloquer les fonctions critiques : devis, etudes PV, PDF et facturation.</p>
      <p style="margin:0 0 22px">
        <a href="${verifyUrl}" style="display:inline-block;background:#2e1a47;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700">Verifier mon email</a>
      </p>
      <p style="margin:0;color:#64748b;font-size:13px">Ce lien expire dans 24 heures.</p>
    `),
  });
}

export async function sendWelcomeEmail({ to }) {
  const onboardingUrl = `${appBaseUrl().replace(/\/+$/, "")}/dashboard?onboarding=1`;
  return sendSystemMail({
    to,
    subject: "Bienvenue sur SolarNext",
    text: `Votre email est confirme. Demarrez l'onboarding SolarNext : ${onboardingUrl}`,
    html: shellHtml(`
      <p style="margin:0 0 16px">Votre email est confirme. Bienvenue sur SolarNext.</p>
      <p style="margin:0 0 22px">Vous pouvez maintenant utiliser les fonctions critiques de votre CRM photovoltaique.</p>
      <p style="margin:0">
        <a href="${onboardingUrl}" style="display:inline-block;background:#2e1a47;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700">Demarrer l'onboarding</a>
      </p>
    `),
  });
}

export async function sendNewSessionAlertEmail({ to, location, device }) {
  const secureUrl = `${appBaseUrl().replace(/\/+$/, "")}/settings/security`;
  const place = location || "lieu inconnu";
  const deviceLabel = device || "appareil inconnu";
  return sendSystemMail({
    to,
    subject: "Nouvelle connexion SolarNext",
    text: `Nouvelle connexion detectee depuis ${place}, ${deviceLabel}. Si ce n'etait pas vous, securisez votre compte : ${secureUrl}`,
    html: shellHtml(`
      <p style="margin:0 0 16px">Nouvelle connexion detectee sur votre compte SolarNext.</p>
      <p style="margin:0 0 18px"><strong>Lieu :</strong> ${place}<br/><strong>Appareil :</strong> ${deviceLabel}</p>
      <p style="margin:0 0 22px">
        <a href="${secureUrl}" style="display:inline-block;background:#2e1a47;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700">Ce n'etait pas moi - securiser mon compte</a>
      </p>
      <p style="margin:0;color:#64748b;font-size:13px">Depuis la page securite, vous pouvez revoquer toutes les autres sessions actives.</p>
    `),
  });
}
