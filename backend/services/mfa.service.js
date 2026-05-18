import crypto from "crypto";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { JWT_SECRET } from "../config/auth.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const MFA_TEMP_TTL = "5m";

function base32Encode(buffer) {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    out += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}

function base32Decode(secret) {
  const clean = String(secret || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function buildOtpAuthUrl({ secret, email, issuer = "SolarNext" }) {
  const label = `${issuer}:${email}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export async function buildTotpQrDataUrl(input) {
  return QRCode.toDataURL(buildOtpAuthUrl(input), { margin: 1, width: 220 });
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function verifyTotpCode({ secret, code, window = 1, now = Date.now() }) {
  const cleanCode = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const counter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(secret, counter + offset);
    const a = Buffer.from(expected);
    const b = Buffer.from(cleanCode);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function hashRecoveryCode(code) {
  return crypto.createHash("sha256").update(String(code).replace(/[^A-Za-z0-9]/g, "").toUpperCase(), "utf8").digest("hex");
}

export function createMfaTempToken(user) {
  return jwt.sign(
    {
      purpose: "MFA_LOGIN",
      userId: user.id,
      organizationId: user.organization_id,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: MFA_TEMP_TTL }
  );
}

export function verifyMfaTempToken(token) {
  try {
    const decoded = jwt.verify(String(token || ""), JWT_SECRET);
    if (decoded?.purpose !== "MFA_LOGIN" || !decoded?.userId || !decoded?.organizationId) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
