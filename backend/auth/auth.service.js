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

/**
 * Session super admin connecté « en tant que » une organisation (courte durée).
 * @param {{ originalAdminId: string, targetOrganizationId: string, originalAdminOrganizationId: string }} p
 */
export function generateImpersonationJWT({ originalAdminId, targetOrganizationId, originalAdminOrganizationId }) {
  const payload = {
    userId: originalAdminId,
    organizationId: targetOrganizationId,
    role: "SUPER_ADMIN_IMPERSONATION",
    originalAdminId,
    originalAdminOrganizationId,
    impersonation: true,
    impersonationType: "ORG",
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "2h" });
}

/**
 * Impersonation d’un utilisateur réel (RBAC effectif, pas de bypass super admin).
 * @param {{ userId: string, organizationId: string, role: string, originalAdminId: string, originalAdminOrganizationId: string }} p
 */
export function generateUserImpersonationJWT({
  userId,
  organizationId,
  role,
  originalAdminId,
  originalAdminOrganizationId,
}) {
  const payload = {
    userId,
    organizationId,
    role,
    impersonation: true,
    impersonationType: "USER",
    originalAdminId,
    originalAdminOrganizationId,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "2h" });
}
