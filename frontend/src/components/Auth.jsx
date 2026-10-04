import { useState } from "react";
import {
  Home,
  ArrowRight,
  AlertCircle,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { api, setToken } from "../lib/api.js";
import { Button, Field, Brand } from "../components/ui.jsx";
export default function Auth({ status, onAuthenticated }) {
  const [mode, setMode] = useState(status.setup_required ? "setup" : "login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e, demo = false) {
    e?.preventDefault();
    setError("");
    setBusy(true);
    try {
      const f = e ? Object.fromEntries(new FormData(e.currentTarget)) : {};
      if (mode === "setup")
        f.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await api(demo ? "auth/demo" : `auth/${mode}`, {
        method: "POST",
        body: f,
      });
      setToken(result.token);
      onAuthenticated(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-art">
        <Brand light />
        <div className="auth-art-main">
          <p className="eyebrow">GOOD PLANS. CALMER DAYS.</p>
          <h1>
            A little clarity.
            <br />A calmer home.
          </h1>
          <p>
            Thoughtful budgets, shared goals, and bills that never slip through
            the cracks.
          </p>
          <div className="auth-sculpture" aria-hidden="true">
            <div className="sun-disc" />
            <div className="arch arch-one" />
            <div className="arch arch-two" />
            <div className="sculpture-line" />
            <div className="little-leaf" />
          </div>
          <div className="auth-art-footer">
            <Home size={16} />
            <span>Built around your home. Designed around you.</span>
          </div>
        </div>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-form">
          <p className="eyebrow">WELCOME HOME</p>
          <h2>
            {status.demo
              ? "A calmer home starts here."
              : mode === "setup"
                ? "Let’s make yourself at home."
                : "Your home, in balance."}
          </h2>
          <p className="muted">
            {status.demo
              ? "Explore a sample household and discover a simpler way to plan."
              : mode === "setup"
                ? "Create your household and your first private budget."
                : "Sign in to see where you stand."}
          </p>
          {!status.demo && (
            <form onSubmit={submit}>
              {mode === "setup" && (
                <>
                  <Field label="Your name">
                    <input
                      required
                      name="display_name"
                      autoComplete="name"
                      placeholder="Alex"
                    />
                  </Field>
                  <Field label="Household name">
                    <input
                      required
                      name="household_name"
                      placeholder="Our home"
                      defaultValue="Our home"
                    />
                  </Field>
                </>
              )}
              <Field label="Username">
                <input
                  required
                  name="username"
                  autoComplete="username"
                  placeholder="Your username"
                />
              </Field>
              <Field
                label="Password"
                help={mode === "setup" ? "Use at least 10 characters." : null}
              >
                <input
                  required
                  name="password"
                  minLength={mode === "setup" ? 10 : undefined}
                  type="password"
                  autoComplete={
                    mode === "setup" ? "new-password" : "current-password"
                  }
                  placeholder="Your password"
                />
              </Field>
              {error && (
                <p className="inline-error" role="alert">
                  <AlertCircle size={16} />
                  {error}
                </p>
              )}
              <Button
                type="submit"
                busy={busy}
                className="full-width"
                icon={ArrowRight}
              >
                {mode === "setup" ? "Create your household" : "Sign in"}
              </Button>
            </form>
          )}
          {status.demo && (
            <>
              {error && (
                <p className="inline-error" role="alert">
                  <AlertCircle size={16} />
                  {error}
                </p>
              )}
              <Button
                className="full-width"
                busy={busy}
                onClick={() => submit(null, true)}
                icon={Sparkles}
              >
                Explore the sample household
              </Button>
              <p className="auth-note">
                Sample data only. A quiet space to try things out.
              </p>
            </>
          )}
          <p className="auth-security">
            <ShieldCheck size={14} />
            Your budget lives on your own server.
          </p>
        </div>
      </section>
    </div>
  );
}
