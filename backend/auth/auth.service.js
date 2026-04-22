import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/auth.js";

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
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}
