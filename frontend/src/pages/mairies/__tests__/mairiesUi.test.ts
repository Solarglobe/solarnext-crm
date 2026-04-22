/**
 * Tests minimaux — libellés & lien portail (CP-MAIRIES-003).
 */
import { describe, it, expect } from "vitest";
import {
  formatMairieStatusLabel,
  formatMairieStatusBadgeText,
  formatMairiePortalTypeLabel,
  getOpenPortalTooltip,
  isLastUsedWithinDays,
  resolveOpenHref,
} from "../mairiesUi";
import type { MairieDto } from "../../../services/mairies.api";

describe("mairiesUi", () => {
  it("formate les libellés statut", () => {
    expect(formatMairieStatusLabel("none")).toBe("Non créé");
    expect(formatMairieStatusLabel("to_create")).toBe("À créer");
    expect(formatMairieStatusLabel("created")).toBe("OK");
  });

  it("formate les badges statut liste (emoji + texte)", () => {
    expect(formatMairieStatusBadgeText("none")).toBe("🔴 Non créé");
    expect(formatMairieStatusBadgeText("to_create")).toBe("🟠 À créer");
    expect(formatMairieStatusBadgeText("created")).toBe("🟢 Compte OK");
  });

  it("formate les types portail", () => {
    expect(formatMairiePortalTypeLabel("online")).toBe("Online");
    expect(formatMairiePortalTypeLabel("email")).toBe("Email");
    expect(formatMairiePortalTypeLabel("paper")).toBe("Papier");
  });

  it("resolveOpenHref — url web", () => {
    const row = {
      portal_url: "https://mairie.fr/",
      portal_type: "online",
      account_email: null,
    } as MairieDto;
    expect(resolveOpenHref(row)).toBe("https://mairie.fr/");
  });

  it("resolveOpenHref — mailto explicite", () => {
    const row = {
      portal_url: "mailto:urbanisme@test.fr",
      portal_type: "email",
      account_email: "autre@test.fr",
    } as MairieDto;
    expect(resolveOpenHref(row)).toBe("mailto:urbanisme@test.fr");
  });

  it("resolveOpenHref — type email sans URL, fallback email compte", () => {
    const row = {
      portal_url: null,
      portal_type: "email",
      account_email: "contact@mairie.fr",
    } as MairieDto;
    expect(resolveOpenHref(row)).toBe("mailto:contact@mairie.fr");
  });

  it("resolveOpenHref — sans URL portail mais email compte (tout type)", () => {
    const row = {
      portal_url: null,
      portal_type: "paper",
      account_email: "mairie@ville.fr",
    } as MairieDto;
    expect(resolveOpenHref(row)).toBe("mailto:mairie@ville.fr");
  });

  it("getOpenPortalTooltip", () => {
    expect(getOpenPortalTooltip("https://x.fr")).toBe("Ouvrir le portail");
    expect(getOpenPortalTooltip("mailto:a@b.fr")).toBe("Contacter la mairie");
    expect(getOpenPortalTooltip(null)).toBe("");
  });

  it("isLastUsedWithinDays", () => {
    const recentIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(isLastUsedWithinDays(recentIso, 7)).toBe(true);
    expect(isLastUsedWithinDays(null, 7)).toBe(false);
    const oldIso = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(isLastUsedWithinDays(oldIso, 7)).toBe(false);
  });
});
