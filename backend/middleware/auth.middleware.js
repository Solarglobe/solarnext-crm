import jwt from "jsonwebtoken";

export function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token manquant" });
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;
  if (!secret) return res.status(500).json({ error: "JWT_SECRET manquant" });
  try {
    const decoded = jwt.verify(token, secret);
    const userId = decoded.userId ?? decoded.id;
    const organizationId = decoded.organizationId ?? decoded.organization_id;
    req.user = {
      ...decoded,
      userId,
      id: userId,
      organizationId,
      organization_id: organizationId,
    };
    next();
  } catch {
    return res.status(401).json({ error: "Token invalide ou expiré" });
  }
}
