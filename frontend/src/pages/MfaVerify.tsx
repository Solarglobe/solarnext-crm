import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { verifyMfaLogin } from "../services/auth.service";
import "./login-premium.css";

export default function MfaVerify() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem("solarnext_mfa_token")) {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const mfaToken = sessionStorage.getItem("solarnext_mfa_token") || "";
    if (!mfaToken) {
      navigate("/login", { replace: true });
      return;
    }
    setLoading(true);
    try {
      const session = await verifyMfaLogin(mfaToken, code);
      sessionStorage.removeItem("solarnext_mfa_token");
      navigate(session.user?.onboardingCompleted === false ? "/onboarding" : "/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Code MFA invalide");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-panel-left" aria-hidden="true">
        <div className="login-brand">
          <div className="logo-container">
            <img src="/dark-logo.png" alt="SolarNext" className="login-brand-logo" decoding="async" />
          </div>
          <p className="login-brand-pitch">Validation securisee de votre session.</p>
        </div>
      </div>
      <div className="login-panel-right">
        <div className="login-card">
          <header className="login-card-header">
            <h1 className="login-title">Code de securite</h1>
            <p className="login-tagline">Entrez le code a 6 chiffres ou un code de secours.</p>
          </header>
          <form className="login-form" onSubmit={submit}>
            <div className="login-field">
              <label htmlFor="mfa-code">Code MFA</label>
              <div className="login-input-wrap">
                <input
                  id="mfa-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  placeholder="123456"
                  required
                />
              </div>
            </div>
            {error ? <div className="login-error">{error}</div> : null}
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? "Verification..." : "Valider"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
