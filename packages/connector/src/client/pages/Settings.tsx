import React, { useEffect, useState } from "react";
import { get, post } from "../api";
import { useAuth } from "../hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { LogOut, Trash2, RotateCw, ExternalLink } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function Settings() {
  const { user, signOut, refresh } = useAuth();
  const [info, setInfo] = useState<any>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [analyticsEnabled, setAnalyticsEnabled] = useState<boolean | null>(null);
  const [analyticsBusy, setAnalyticsBusy] = useState(false);

  useEffect(() => {
    get("/api/info").then(setInfo).catch(() => { });
  }, []);

  useEffect(() => {
    get<{ enabled: boolean }>("/api/analytics/status")
      .then((r) => setAnalyticsEnabled(r.enabled))
      .catch(() => { });
  }, []);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await post("/api/auth/delete-account");
      if (res.error) throw new Error(res.error);
      setDeleteOpen(false);
      await refresh();
    } catch (err: any) {
      setDeleteError(err.message ?? "Unable to delete your account right now.");
    } finally {
      setDeleting(false);
    }
  };

  const handleAnalyticsToggle = async (checked: boolean) => {
    if (analyticsBusy) return;
    const prev = analyticsEnabled;
    setAnalyticsEnabled(checked);
    setAnalyticsBusy(true);
    try {
      const res = await post<{ enabled: boolean }>("/api/analytics/enabled", {
        enabled: checked,
      });
      setAnalyticsEnabled(res.enabled);
    } catch {
      if (prev !== null) setAnalyticsEnabled(prev);
    } finally {
      setAnalyticsBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-10">
        <h2 className="text-3xl font-semibold tracking-tight text-fg">
          Settings
        </h2>
        <p className="mt-2 text-secondary">
          Manage your account, view system info, and configure your connector.
        </p>
      </div>

      <div className="space-y-8">
        <section>
          <h3 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted">
            Account
          </h3>
          <Card>
            <CardContent className="space-y-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm text-secondary">Signed in as</p>
                  <p className="mt-0.5 break-all text-lg font-medium text-fg">{user?.email}</p>
                </div>
                <Button variant="outline" size="sm" onClick={signOut} className="shrink-0">
                  <LogOut className="size-3.5" />
                  Sign Out
                </Button>
              </div>
              <div className="border-t border-line pt-4">
                <p className="text-sm text-secondary">
                  Manage your password and account at{" "}
                  <a
                    href="https://usenocturne.com/login"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent transition hover:text-accent-hover"
                  >
                    usenocturne.com
                    <ExternalLink className="size-3" />
                  </a>
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <h3 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted">
            System
          </h3>
          <Card>
            <CardContent>
              <div className="space-y-3">
                {[
                  ["Connector Version", info?.version ?? "Unknown"],
                  ["OS Version", info?.osVersion ?? "Unknown"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-lg bg-bg px-3 py-2.5">
                    <span className="text-sm text-secondary">{label}</span>
                    <span className="text-sm font-medium text-fg">{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <h3 className="mb-4 text-xs font-medium uppercase tracking-widest text-muted">
            Privacy
          </h3>
          <Card>
            <CardContent>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-fg">Analytics</p>
                  <p className="mt-0.5 text-sm text-secondary">
                    Help improve Nocturne by sharing usage data.
                  </p>
                </div>
                <Switch
                  checked={analyticsEnabled ?? true}
                  onCheckedChange={handleAnalyticsToggle}
                  disabled={analyticsEnabled === null || analyticsBusy}
                  aria-label="Toggle analytics"
                  className="shrink-0"
                />
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <h3 className="mb-4 text-xs font-medium uppercase tracking-widest text-destructive/60">
            Danger Zone
          </h3>
          <Card className="border-destructive/20">
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-fg">Reboot Device</p>
                  <p className="mt-0.5 text-sm text-secondary">
                    Temporarily disconnects all services while the device restarts.
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="shrink-0">
                      <RotateCw className="size-3.5" />
                      Reboot
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reboot Connector</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to reboot the device? This will temporarily disconnect all services.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => post("/api/power/reboot")}>
                        Reboot
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <div className="border-t border-line" />

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-fg">Delete Account</p>
                  <p className="mt-0.5 text-sm text-secondary">
                    Permanently removes your account and all associated data.
                  </p>
                </div>
                <AlertDialog
                  open={deleteOpen}
                  onOpenChange={(open) => {
                    if (deleting) return;
                    setDeleteOpen(open);
                    if (!open) setDeleteError(null);
                  }}
                >
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" className="shrink-0">
                      <Trash2 className="size-3.5" />
                      Delete Account
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Account</AlertDialogTitle>
                      <AlertDialogDescription>
                        Deleting your account will remove all associated data. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    {deleteError && (
                      <Alert variant="destructive">
                        <AlertDescription>{deleteError}</AlertDescription>
                      </Alert>
                    )}
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={deleting}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        disabled={deleting}
                        onClick={handleDelete}
                      >
                        {deleting ? "Deleting..." : "Delete Account"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
