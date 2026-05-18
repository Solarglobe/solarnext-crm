import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { buildApiUrl } from "@/config/crmApiBase";
import { setAuthToken } from "../services/api";
import { applyTheme, readStoredTheme } from "../theme/themeApply";
import "./login-premium.css";

type Strength = "weak" | "medium" | "strong";

function passwordStrength(password: string): Strength {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (score >= 4) return "strong";
  if (score >= 2) return "medium";
  return "weak";
}

export default function Signup() {
  const navigate = useNavigate();
  const [organizationName, setOrganizationName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [rgeNumber, setRgeNumber] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [acceptCgu, setAcceptCgu] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const strength = useMemo(() => passwordStrength(password), [password]);

  useEffect(() => {
    document.documentElement.classList.add("sn-auth-page");
    document.documentElement.classList.remove("sn-app-page");
    applyTheme("light");
    return () => {
      document.documentElement.classList.remove("sn-auth-page");
      applyTheme(readStoredTheme());
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== passwordConfirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (!acceptCgu) {
      setError("Vous devez accepter les CGU pour creer le compte.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(buildApiUrl("/auth/register"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName,
          firstName,
          lastName,
          email,
          phone,
          rgeNumber,
          password,
          passwordConfirm,
          acceptCgu,
          cguVersion: "1.x",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Inscription impossible");
      setAuthToken(data.accessToken || data.token || null);
      navigate("/onboarding", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur reseau");
    } finally {
      setLoading(false);
    }
  }

  const strengthLabel =
    strength === "strong" ? "Robuste" : strength === "medium" ? "Correct" : "Faible";
  const strengthColor =
    strength === "strong" ? "#15803d" : strength === "medium" ? "#b45309" : "#b91c1c";

  return (
    <div className="login-page">
      <div className="login-panel-left" aria-hidden="true">
        <div className="login-brand">
          <div className="logo-container">
            <img src="/dark-logo.png" alt="SolarNext" className="login-brand-logo" decoding="async" />
          </div>
          <p className="login-brand-pitch">Creez votre espace installateur en autonomie.</p>
        </div>
      </div>
      <main className="login-panel-right">
        <section className="login-card" aria-label="Inscription">
          <header className="login-header">
            <h1>Essai gratuit 14 jours</h1>
            <p className="login-tagline">Creez votre organisation SolarNext en quelques minutes.</p>
          </header>

          <form onSubmit={handleSubmit} className="login-form" noValidate>
            <div className="login-field">
              <label htmlFor="organizationName">Nom de l'entreprise installateur</label>
              <div className="login-input-wrap">
                <input id="organizationName" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} required />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="login-field">
                <label htmlFor="firstName">Prenom admin</label>
                <div className="login-input-wrap">
                  <input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="given-name" />
                </div>
              </div>
              <div className="login-field">
                <label htmlFor="lastName">Nom admin</label>
                <div className="login-input-wrap">
                  <input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required autoComplete="family-name" />
                </div>
              </div>
            </div>
            <div className="login-field">
              <label htmlFor="email">Adresse e-mail</label>
              <div className="login-input-wrap">
                <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="login-field">
                <label htmlFor="phone">Telephone optionnel</label>
                <div className="login-input-wrap">
                  <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
                </div>
              </div>
              <div className="login-field">
                <label htmlFor="rgeNumber">Numero RGE optionnel</label>
                <div className="login-input-wrap">
                  <input id="rgeNumber" value={rgeNumber} onChange={(e) => setRgeNumber(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="login-field">
              <label htmlFor="password">Mot de passe</label>
              <div className="login-input-wrap">
                <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
              </div>
              <div style={{ fontSize: 12, color: strengthColor, marginTop: 6 }}>Force : {strengthLabel}</div>
            </div>
            <div className="login-field">
              <label htmlFor="passwordConfirm">Confirmation</label>
              <div className="login-input-wrap">
                <input id="passwordConfirm" type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} required autoComplete="new-password" />
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "#334155" }}>
              <input type="checkbox" checked={acceptCgu} onChange={(e) => setAcceptCgu(e.target.checked)} required style={{ marginTop: 2 }} />
              <span>J'accepte les CGU v1.x.</span>
            </label>
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? "Creation..." : "Creer mon compte"}
            </button>
            <p className="login-tagline" style={{ textAlign: "center" }}>
              Deja un compte ? <Link to="/login">Se connecter</Link>
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
