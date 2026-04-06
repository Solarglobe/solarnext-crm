import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { login, isAuthenticated } from "../services/auth.service";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("sn-auth-page");
    document.documentElement.classList.remove("sn-app-page");
    return () => {
      document.documentElement.classList.remove("sn-auth-page");
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate("/leads", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/leads", { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Identifiants invalides"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sn-auth-bg">
      <div className="sn-auth-center">
        <Card
          className="sn-card-premium"
          style={{
            width: "100%",
            maxWidth: 480,
            padding: "36px 42px",
            borderRadius: "22px"
          }}
        >
          <header className="sn-auth-header">
            <h1 className="sn-auth-title" style={{ marginBottom: "8px" }}>
              SolarNext <span className="sn-auth-title-accent">CRM</span>
            </h1>
            <p className="sn-auth-subtitle" style={{ marginBottom: "32px" }}>
              Plateforme de gestion photovoltaïque
            </p>
          </header>

          <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="email"
                style={{
                  display: "block",
                  marginBottom: 4,
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-muted)"
                }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="sn-input"
                style={{ height: 44, padding: "0 14px" }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="password"
                style={{
                  display: "block",
                  marginBottom: 4,
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-muted)"
                }}
              >
                Mot de passe
              </label>
              <div style={{ position: "relative" }}>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="sn-input"
                  style={{ height: 44, padding: "0 14px", paddingRight: "42px" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-muted)"
                  }}
                >
                  {showPassword ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            {error && <p className="sn-auth-error">{error}</p>}

            <div style={{ marginTop: 20 }}>
              <Button
                type="submit"
                variant="primary"
                disabled={loading}
                fullWidth
                className="sn-auth-submit"
                style={{ height: 44 }}
              >
                {loading ? "Connexion..." : "Se connecter"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
