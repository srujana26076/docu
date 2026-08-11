import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/signup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Create account — DocuEdit" },
      { name: "description", content: "Create a DocuEdit account to upload, edit and organize your business documents." },
      { property: "og:title", content: "Create account — DocuEdit" },
      { property: "og:description", content: "Create a DocuEdit account in seconds." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) {
        setError(error.message || "Couldn't create your account. Please try again.");
        return;
      }
      if (!data.session) {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (signInError) {
          setError("Account created, but sign-in failed. Please sign in manually.");
          return;
        }
      }
      toast.success("Account created successfully");
      navigate({ to: "/", replace: true });
    } catch {
      setError("Couldn't create your account. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold text-foreground">Create your DocuEdit account</h1>
        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <Input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input type="password" required placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          Already registered? <Link to="/login" className="text-primary underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
