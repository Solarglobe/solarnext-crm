/**
 * Protection SSRF pour connecteurs IMAP/SMTP manuels.
 */

import dns from "dns/promises";
import net from "net";

export const MailNetworkGuardErrorCodes = {
  INVALID_ENDPOINT: "MAIL_ENDPOINT_INVALID",
  BLOCKED_HOST: "MAIL_ENDPOINT_BLOCKED",
  DNS_FAILED: "MAIL_ENDPOINT_DNS_FAILED",
};

function guardError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isBlockedIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version !== 6) return true;
  const low = ip.toLowerCase();
  if (low.startsWith("::ffff:")) {
    return isPrivateIPv4(low.slice("::ffff:".length));
  }
  return (
    low === "::1" ||
    low === "::" ||
    low.startsWith("fc") ||
    low.startsWith("fd") ||
    low.startsWith("fe8") ||
    low.startsWith("fe9") ||
    low.startsWith("fea") ||
    low.startsWith("feb") ||
    false
  );
}

function assertResolvedAddressesSafe(addresses) {
  if (!addresses.length) {
    throw guardError(MailNetworkGuardErrorCodes.DNS_FAILED, "Aucune adresse DNS resolue");
  }
  for (const a of addresses) {
    if (isBlockedIp(String(a.address))) {
      throw guardError(MailNetworkGuardErrorCodes.BLOCKED_HOST, "Endpoint mail prive/local bloque");
    }
  }
}

export async function assertSafeMailEndpoint(input) {
  if (process.env.MAIL_ALLOW_PRIVATE_HOSTS === "1") return { ok: true, skipped: true };
  const host = String(input?.host || "").trim();
  const port = Number(input?.port);
  if (!host || host.includes("/") || host.includes("@") || host.includes("\\") || !Number.isFinite(port) || port < 1 || port > 65535) {
    throw guardError(MailNetworkGuardErrorCodes.INVALID_ENDPOINT, "Endpoint mail invalide");
  }

  const literal = net.isIP(host);
  const addresses = literal ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true }).catch((e) => {
    throw guardError(MailNetworkGuardErrorCodes.DNS_FAILED, e instanceof Error ? e.message : String(e));
  });
  assertResolvedAddressesSafe(addresses);
  return { ok: true, addresses: addresses.map((a) => a.address) };
}

export function createSafeMailLookup() {
  return async function safeMailLookup(hostname, opts, cb) {
    const callback = typeof opts === "function" ? opts : cb;
    const options = typeof opts === "function" ? {} : opts || {};
    try {
      await assertSafeMailEndpoint({ host: hostname, port: 1 });
      const addresses = await dns.lookup(hostname, { all: true, verbatim: true, family: options.family || 0 });
      assertResolvedAddressesSafe(addresses);
      if (options.all) {
        callback(null, addresses);
        return;
      }
      const first = addresses[0];
      callback(null, first.address, first.family);
    } catch (e) {
      callback(e);
    }
  };
}

export const __test = { isBlockedIp, assertResolvedAddressesSafe };
