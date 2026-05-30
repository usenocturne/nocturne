import React, { useState } from "react";
import { post } from "../api";
import { useAuth } from "../hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Gradient } from "@/components/Gradient";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PairConnectorFormProps {
  title?: string;
  subtitle?: React.ReactNode;
}

function formatCode(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8);
  if (clean.length <= 4) return clean;
  return clean.slice(0, 4) + "-" + clean.slice(4);
}

function stripCode(formatted: string): string {
  return formatted.replace(/[^a-zA-Z0-9]/g, "");
}

export function PairConnectorForm({
  title = "Pair Nocturne Connector",
  subtitle = (
    <>
      Visit{" "}
      <a
        href="https://usenocturne.com/login"
        target="_blank"
        rel="noreferrer"
        className="text-accent transition hover:text-accent-hover"
      >
        usenocturne.com/login
      </a>{" "}
      on your phone or computer to get a pairing code.
    </>
  ),
}: PairConnectorFormProps = {}) {
  const { refresh } = useAuth();
  const [display, setDisplay] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rawLength = stripCode(display).length;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCode(e.target.value);
    setDisplay(formatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rawLength < 8) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await post("/api/auth/pair", { code: display.trim() });
      if (res?.error) throw new Error(res.error);
      await refresh();
    } catch (err: any) {
      setError(err?.message ?? "Pairing failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-pretty text-2xl font-medium tracking-tighter text-fg">
          {title}
        </h1>
        <p className="mt-2 text-sm text-secondary">{subtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="pair-code" className="text-sm font-medium text-fg">
            Pairing Code
          </label>
          <Input
            id="pair-code"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={9}
            placeholder="XXXX-XXXX"
            value={display}
            onChange={handleChange}
            disabled={submitting}
            className="h-12 font-mono text-lg tracking-[0.25em] text-center uppercase"
          />
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={submitting || rawLength < 8}
          className="w-full"
        >
          {submitting ? "Pairing..." : "Pair Connector"}
        </Button>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function PairConnector() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center p-6 bg-bg">
      <Gradient className="absolute inset-0" />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo className="h-9 text-fg" />
        </div>
        <Card>
          <CardContent>
            <PairConnectorForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
