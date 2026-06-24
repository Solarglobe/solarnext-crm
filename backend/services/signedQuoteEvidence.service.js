/**
 * Dossier de preuve du devis signé :
 *  - paraphe (miniature de la signature client) + pied de page sur CHAQUE page du PDF assemblé ;
 *  - page « Certificat de signature électronique » ajoutée en fin de document ;
 *  - empreintes SHA-256 (corps du document, puis PDF final).
 *
 * Le paraphe électronique n'est pas une exigence légale (l'intégrité est garantie par le hash),
 * mais il reproduit l'usage papier « parafé sur chaque page » et rassure les parties.
 */

import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import logger from "../app/core/logger.js";

const A4_W = 595.28;
const A4_H = 841.89;
const GOLD = rgb(0.64, 0.49, 0.18);
const GREY = rgb(0.33, 0.33, 0.36);
const LIGHT = rgb(0.55, 0.55, 0.58);
const DARK = rgb(0.09, 0.08, 0.11);

export function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Remplace les caractères hors WinAnsi (polices standard pdf-lib) pour éviter un crash d'encodage. */
function winAnsiSafe(s) {
  return String(s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, "-")
    .replace(/→|↔/g, "->")
    .replace(/[^\x00-ÿŒœ€—•…]/g, "?");
}

/**
 * Appose le paraphe + pied de page sur chaque page du buffer.
 * @param {Buffer} pdfBuffer
 * @param {object} opts
 * @param {Buffer} opts.clientSignaturePng — PNG de la signature client (réduit en paraphe)
 * @param {string|null} opts.quoteNumber
 * @param {string} opts.signedAtLabel — ex. "10/06/2026 à 14:32"
 * @returns {Promise<Buffer>}
 */
export async function stampQuoteParaphes(pdfBuffer, { clientSignaturePng, quoteNumber, signedAtLabel }) {
  const doc = await PDFDocument.load(pdfBuffer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let sigImage = null;
  try {
    sigImage = clientSignaturePng ? await doc.embedPng(clientSignaturePng) : null;
  } catch (e) {
    logger.warn("QUOTE_PARAPHE_PNG_EMBED_FAILED", { message: e.message });
  }

  const pages = doc.getPages();
  const total = pages.length;
  const ref = quoteNumber ? `Devis ${quoteNumber}` : "Devis";
  pages.forEach((page, i) => {
    const { width } = page.getSize();
    const footer = winAnsiSafe(
      `${ref} — page ${i + 1}/${total} — signé électroniquement le ${signedAtLabel} — paraphe électronique du client ci-contre`
    );
    page.drawText(footer, {
      x: 24,
      y: 12,
      size: 6.5,
      font,
      color: LIGHT,
    });
    if (sigImage) {
      const h = 22;
      const w = (sigImage.width / sigImage.height) * h;
      page.drawImage(sigImage, {
        x: width - w - 24,
        y: 8,
        width: w,
        height: h,
        opacity: 0.9,
      });
    }
  });

  return Buffer.from(await doc.save());
}

function drawLine(page, font, fontBold, y, label, value, { size = 9 } = {}) {
  page.drawText(winAnsiSafe(label), { x: 56, y, size, font: fontBold, color: GREY });
  const lines = wrapText(winAnsiSafe(value ?? "—"), font, size, A4_W - 56 - 210 - 40);
  let yy = y;
  for (const ln of lines) {
    page.drawText(ln, { x: 266, y: yy, size, font, color: DARK });
    yy -= size + 4;
  }
  return Math.min(y - size - 6, yy + size + 4 - (size + 6));
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const probe = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(probe, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = probe;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : ["—"];
}

/**
 * Ajoute la page « Certificat de signature électronique » en fin de PDF.
 * @param {Buffer} pdfBuffer
 * @param {object} ev — dossier de preuve
 * @returns {Promise<Buffer>}
 */
export async function appendSignatureCertificatePage(pdfBuffer, ev) {
  const doc = await PDFDocument.load(pdfBuffer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([A4_W, A4_H]);

  let y = A4_H - 64;
  page.drawText("CERTIFICAT DE SIGNATURE ÉLECTRONIQUE", {
    x: 56, y, size: 15, font: fontBold, color: DARK,
  });
  y -= 18;
  page.drawText(winAnsiSafe(`Dossier de preuve — ${ev.quoteNumber ? `Devis n° ${ev.quoteNumber}` : "Devis"}`), {
    x: 56, y, size: 10, font, color: GOLD,
  });
  y -= 10;
  page.drawLine({ start: { x: 56, y }, end: { x: A4_W - 56, y }, thickness: 1, color: GOLD });
  y -= 26;

  const section = (title) => {
    page.drawText(winAnsiSafe(title.toUpperCase()), { x: 56, y, size: 8.5, font: fontBold, color: GOLD });
    y -= 16;
  };
  const kv = (label, value) => {
    y = drawLine(page, font, fontBold, y, label, value);
  };

  section("Signataire (client)");
  kv("Nom", ev.signerName);
  const otpChannelLabel = ev.otp?.channel === "sms" ? "SMS" : "Email";
  kv(`${otpChannelLabel} vérifié (OTP)`, ev.otp?.destination ?? ev.otp?.email ?? "—");
  kv(
    "Vérification OTP",
    ev.otp
      ? `Code à usage unique envoyé par ${ev.otp.channel === "sms" ? "SMS" : "email"}, validé le ${ev.otp.verifiedAtLabel}`
      : "Non réalisée"
  );
  kv("Lieu de signature", ev.signaturePlace);
  y -= 8;

  section("Horodatage et contexte technique");
  kv("Signé le (heure serveur)", ev.signedAtServerLabel);
  kv("Heure poste de signature", ev.clientSignedAtLabel);
  kv("Adresse IP", ev.ip);
  kv("Navigateur (user-agent)", ev.userAgent);
  kv("Opérateur (conseiller)", ev.operatorLabel);
  y -= 8;

  section("Consentements recueillis");
  kv("Bon pour accord", ev.readApprovedLabel);
  kv("Pad de signature", ev.padAcceptanceLabel);
  kv("CGV", ev.cgv
    ? `Acceptées — ${ev.cgv.acceptedLabel}`
    : "Non configurées dans l'organisation");
  if (ev.cgv) {
    kv("Version des CGV", ev.cgv.versionLabel);
    kv("Empreinte CGV (SHA-256)", ev.cgv.sha256 ?? "—");
    kv("Lecture intégrale", ev.cgv.scrolledToEndAtLabel
      ? `Défilement jusqu'au terme du document le ${ev.cgv.scrolledToEndAtLabel}`
      : "—");
  }
  kv(
    "Demande expresse d'exécution anticipée (L221-25)",
    ev.expressExecution?.requested
      ? `Demandée par le client${ev.expressExecution.recordedAtLabel ? ` le ${ev.expressExecution.recordedAtLabel}` : ""} — ${ev.expressExecution.label ?? "commencement immédiat des prestations SolarGlobe"}`
      : "Non demandée (prestations engagées après le délai légal de rétractation)"
  );
  y -= 8;

  section("Intégrité du document");
  kv("Empreinte SHA-256 (hors cette page)", ev.bodySha256);
  kv("Pages parafées", String(ev.paraphedPages ?? "—"));
  y -= 14;

  const legal = winAnsiSafe(
    "Ce certificat est généré automatiquement et fait partie intégrante du document signé. " +
    "La signature électronique recueillie constitue une signature électronique au sens de l'article 25 du " +
    "règlement (UE) n° 910/2014 (eIDAS) : l'effet juridique d'une signature électronique ne peut être refusé " +
    "au seul motif qu'elle se présente sous forme électronique. L'intégrité du document est vérifiable en " +
    "recalculant l'empreinte SHA-256 ci-dessus. Toute modification du fichier après signature invalide cette empreinte."
  );
  for (const ln of wrapText(legal, font, 8, A4_W - 112)) {
    page.drawText(ln, { x: 56, y, size: 8, font, color: LIGHT });
    y -= 12;
  }

  return Buffer.from(await doc.save());
}

/** dd/mm/yyyy à HH:MM (heure de Paris) pour libellés du certificat. */
export function formatFrDateTime(isoOrDate) {
  try {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return "—";
    const date = d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
    const time = d.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
    return `${date} à ${time}`;
  } catch {
    return "—";
  }
}
