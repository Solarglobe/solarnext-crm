import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const SALT_ROUNDS = 12;

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function generateJWT(user) {
  const payload = {
    userId: user.id,
    organizationId: user.organization_id,
    role: user.role
  };
  const secret = process.env.JWT_SECRET || process.env.JWT_SECRET_KEY;
  if (!secret) throw new Error("JWT_SECRET manquant");
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}
