import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useEvent } from "../hooks/useWebSocket";
import { NocturneAuth } from "./NocturneAuth";
import { SpotifyAuth } from "./SpotifyAuth";
import { BluetoothPairing } from "./BluetoothPairing";
import { AnalyticsConsent } from "./AnalyticsConsent";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Logo } from "@/components/Logo";
import { get, post } from "../api";
import { Alert, AlertDescription } from "@/components/ui/alert";

const steps = ["Welcome", "Account", "Spotify", "Bluetooth", "Analytics", "Done"];

export function SetupWizard() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const { authenticated, refresh } = useAuth();
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [spotifyLinked, setSpotifyLinked] = useState(false);

  const next = () => {
    if (step < steps.length - 1) setStep(step + 1);
  };
  const prev = () => {
    if (step > 0) setStep(step - 1);
  };

  const finishSetup = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      const res = await post("/api/setup/complete");
      if (res.error) throw new Error(res.error);
      await refresh();
      navigate("/");
    } catch (err: any) {
      setFinishError(err.message ?? "Failed to save setup status");
    } finally {
      setFinishing(false);
    }
  };

  useEffect(() => {
    get("/api/spotify/status")
      .then((data) => setSpotifyLinked(data?.authState?.status === "linked"))
      .catch(() => { });
  }, []);

  useEvent<{ status?: string }>(
    "spotify.auth.status",
    useCallback((state) => {
      setSpotifyLinked(state?.status === "linked");
    }, []),
  );

  const nextDisabled =
    (step === 1 && !authenticated) || (step === 2 && !spotifyLinked);

  const prevAuthRef = useRef(authenticated);
  useEffect(() => {
    if (step === 1 && !prevAuthRef.current && authenticated) {
      setStep(2);
    }
    prevAuthRef.current = authenticated;
  }, [authenticated, step]);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <div className="py-6 sm:py-8">
        <Logo className="mx-auto h-8 sm:h-9" />
      </div>
      <div className="px-4 sm:px-6">
        <div className="mx-auto w-full max-w-5xl">
          <Progress value={(step / (steps.length - 1)) * 100} />
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-8 pt-6 sm:p-6">
        <div className="w-full max-w-5xl">
          <div className="mb-8 flex items-center justify-center gap-3 sm:gap-4">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                      step === i
                        ? "bg-accent text-white"
                        : step > i
                        ? "bg-raised text-fg border border-line"
                        : "bg-inset text-muted border border-line"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <span
                    className={`hidden text-sm sm:block ${
                      step === i ? "text-fg" : step > i ? "text-secondary" : "text-muted"
                    }`}
                  >
                    {s}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className="h-px w-4 bg-line sm:w-8" />
                )}
              </div>
            ))}
          </div>

          {step === 0 && (
            <Card className="mx-auto max-w-2xl">
              <CardContent className="text-center">
                <h1 className="mb-4 text-pretty text-3xl font-medium tracking-tighter text-fg sm:text-4xl">
                  Welcome to Nocturne
                </h1>
                <p className="mb-8 text-secondary">
                  Let's set up your Raspberry Pi to connect with your Car Thing.
                </p>
                <Button size="lg" onClick={next} className="w-full sm:w-auto">
                  Get Started
                </Button>
              </CardContent>
            </Card>
          )}

          {step === 1 && <NocturneAuth />}
          {step === 2 && <SpotifyAuth onLinked={() => setStep(3)} />}
          {step === 3 && <BluetoothPairing />}
          {step === 4 && <AnalyticsConsent />}

          {step === 5 && (
            <Card className="mx-auto max-w-2xl">
              <CardContent className="text-center">
                <h2 className="mb-4 text-pretty text-2xl font-medium tracking-tighter text-fg sm:text-3xl">
                  All Set!
                </h2>
                <p className="mb-8 text-secondary">
                  Your Nocturne connector is ready. Head to the dashboard to manage your devices.
                </p>
                <Button
                  size="lg"
                  onClick={finishSetup}
                  disabled={finishing}
                  className="w-full sm:w-auto"
                >
                  {finishing ? "Saving..." : "Go to Dashboard"}
                </Button>
                {finishError && (
                  <Alert variant="destructive" className="mt-4">
                    <AlertDescription>{finishError}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}

          {step > 0 && step < 5 && (
            <div className="mx-auto mt-6 flex max-w-2xl justify-between gap-3 sm:mt-8">
              <Button variant="outline" onClick={prev}>
                Back
              </Button>
              <Button variant="default" onClick={next} disabled={nextDisabled}>
                {step === 4 ? "Finish" : "Next"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
