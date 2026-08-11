import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — DocuEdit" },
      { name: "description", content: "Sign in to your DocuEdit workspace to manage invoices, quotations and templates." },
      { property: "og:title", content: "Sign in — DocuEdit" },
      { property: "og:description", content: "Sign in to your DocuEdit workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        const msg = (error.message || "").toLowerCase();
        if (msg.includes("invalid login") || msg.includes("credentials") || msg.includes("not confirmed")) {
          setError("Invalid email or password");
        } else {
          setError("Couldn't sign in right now. Please check your connection and try again.");
        }
        return;
      }
      navigate({ to: "/", replace: true });
    } catch {
      setError("Couldn't sign in right now. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold text-foreground">Sign in to DocuEdit</h1>
        <p className="mt-1 text-sm text-muted-foreground">Welcome back.</p>
        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <Input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          No account? <Link to="/signup" className="text-primary underline">Create one</Link>
        </p>
      </div>
    </div>
  );
}
