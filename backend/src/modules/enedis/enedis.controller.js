/**
 * Contrôleur OAuth Enedis — connect (redirection) et callback (échange code → token)
 */

import * as enedisService from "./enedis.service.js";

/**
 * GET /api/enedis/connect — redirige vers la page d’autorisation Enedis
 */
export function connect(req, res) {
  try {
    const { url } = enedisService.buildAuthUrl();
    console.log("[Enedis] redirect to authorize");
    res.redirect(302, url);
  } catch (err) {
    console.error("[Enedis] connect error", err.message);
    res.status(500).json({ error: "ENEDIS_CONFIG", message: err.message });
  }
}

/**
 * GET /api/enedis/callback — reçoit ?code (et optionnellement ?state), échange contre token, renvoie token + infos
 */
export async function callback(req, res) {
  const code = req.query?.code;
  if (!code) {
    console.warn("[Enedis] callback sans code — query:", req.query);
    res.status(400).json({ error: "missing_code", message: "Paramètre code manquant" });
    return;
  }

  console.log("[Enedis] callback reçu ?code=" + (code.length > 12 ? code.slice(0, 12) + "…" : code));

  try {
    const tokenData = await enedisService.exchangeCodeForToken(code);
    const accessToken = tokenData.access_token;
    const expiresIn = tokenData.expires_in;
    const tokenType = tokenData.token_type;

    console.log("[Enedis] access_token reçu:", accessToken ? accessToken.slice(0, 12) + "…" : "(vide)");
    console.log("[Enedis] expires_in:", expiresIn ?? "(non fourni)");
    console.log("[Enedis] token_type:", tokenType ?? "(non fourni)");

    res.status(200).json({
      access_token: accessToken,
      expires_in: expiresIn,
      token_type: tokenType ?? "Bearer",
    });
  } catch (err) {
    console.error("[Enedis] callback error:", err.message);
    if (err.rawResponse != null) {
      console.error("[Enedis] réponse brute Enedis:", err.rawResponse);
    }
    res.status(502).json({
      error: "ENEDIS_TOKEN",
      message: err.message,
      ...(err.rawResponse != null && { raw_response: err.rawResponse }),
    });
  }
}
