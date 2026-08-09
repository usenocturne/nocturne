import React, { useCallback, useRef, useState } from "react";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  RefreshIcon,
  SettingsUpdateIcon,
} from "../common/icons";
import {
  useNocturneInfo,
  sendNocturneWsRequest,
} from "../../hooks/useNocturned";
import { useSettings } from "../../contexts/SettingsContext";
import {
  applyReloadOnlyOta,
  assertOtaActivationScheduled,
  isReloadOnlyKind,
  useOTA,
} from "../../contexts/OTAContext";
import type { OtaActivateRequest, OtaActivateResponse } from "@schema/ota";

const PHASE_LABELS: Record<string, string> = {
  downloading: "Downloading update…",
  streaming: "Transferring to device…",
  verifying: "Verifying update…",
  writing: "Installing update…",
  confirming: "Finalizing…",
  reboot: "Restarting…",
};

const RELEASE_NOTES = "This update brings new features and bug fixes.";

// Yocto versions carry a build stamp (`4.1.0+20260619213819`); surface it as a
// readable date when present, otherwise show nothing.
function releaseDate(version?: string | null): string | null {
  const m = version?.match(/\+(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function deltaAssetName(asset?: string | null): string | null {
  if (!asset) return null;
  const normalized = asset.toLowerCase();
  if (normalized.includes("system")) return "system image";
  if (normalized.includes("boot")) return "boot image";
  return asset.replace(/\.(img|vfat)\.zck$/i, "").replace(/\.zck$/i, "");
}

function progressLabel(phase?: string | null, asset?: string | null): string {
  const deltaAsset = deltaAssetName(asset);
  if (phase === "streaming" && deltaAsset) {
    return `Transferring ${deltaAsset}…`;
  }
  return PHASE_LABELS[phase || ""] || "Applying update…";
}

const UpdateCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  date?: string | null;
  description?: string | null;
  footer?: React.ReactNode;
}> = ({ icon, title, date, description, footer }) => (
  <div className="p-4 bg-white/10 rounded-xl border border-white/10">
    <div className="flex items-center gap-4">
      <div className="shrink-0">{icon}</div>
      <div className="flex min-w-0 flex-col">
        <div className="text-[26px] font-[580] text-white tracking-tight leading-tight">
          {title}
        </div>
        {date && (
          <div className="text-[18px] font-[520] text-white/50 tracking-tight">
            {date}
          </div>
        )}
      </div>
    </div>
    {description && (
      <div className="mt-4 text-[20px] font-[520] text-white/70 tracking-tight leading-snug">
        {description}
      </div>
    )}
    {footer}
  </div>
);

const ActionButton: React.FC<{
  onClick: () => void | Promise<void>;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ onClick, children, disabled = false }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="w-full rounded-xl border border-white/10 bg-white/10 p-4 text-center text-white transition-colors duration-200 hover:bg-white/20 disabled:cursor-default disabled:opacity-60"
  >
    <span className="text-[24px] font-[560] tracking-tight">{children}</span>
  </button>
);

const StatusRow: React.FC<{
  children: React.ReactNode;
  spinning?: boolean;
}> = ({ children, spinning }) => (
  <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/5 p-4">
    {spinning && <RefreshIcon className="h-6 w-6 animate-spin text-white/60" />}
    <span className="text-[24px] font-[560] text-white/70 tracking-tight">
      {children}
    </span>
  </div>
);

const SoftwareUpdate = () => {
  const applyPendingRef = useRef(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const { version: currentVersion, isLoading: isInfoLoading } =
    useNocturneInfo();
  const { settings } = useSettings();
  const {
    isActive,
    kind,
    version: updateVersion,
    phase,
    percent,
    asset,
    isComplete,
    error,
    isChecking,
    isInstallPending,
    available,
    lastCheckResult,
    requestCheck,
    requestInstall,
    dismissError,
    clearOtaProgress,
  } = useOTA();

  const reloadOnly = isReloadOnlyKind(kind);
  const channel = settings.betaUpdatesEnabled ? "beta" : "stable";
  const cleanVersion = (currentVersion || "").replace(/^v/, "");

  const handleCheck = useCallback(() => {
    requestCheck(cleanVersion, channel);
  }, [requestCheck, cleanVersion, channel]);

  const handleInstall = useCallback(() => {
    requestInstall(cleanVersion);
  }, [requestInstall, cleanVersion]);

  const applyUpdate = useCallback(async () => {
    if (applyPendingRef.current) return;
    applyPendingRef.current = true;
    setIsApplying(true);
    setApplyError(null);

    if (reloadOnly) {
      try {
        await applyReloadOnlyOta(
          kind,
          () => {
            const request: OtaActivateRequest = {};
            return sendNocturneWsRequest<OtaActivateResponse>(
              "ota.activate",
              request,
            ).then((response) => {
              assertOtaActivationScheduled(response);
            });
          },
          () => {
            clearOtaProgress();
            window.location.reload();
          },
        );
      } catch (err) {
        console.error("Reload activation request failed:", err);
        setApplyError(
          err instanceof Error ? err.message : "Failed to schedule activation",
        );
        applyPendingRef.current = false;
        setIsApplying(false);
      }
    } else {
      clearOtaProgress();
      sendNocturneWsRequest("device.power.reboot", {}).catch((err) => {
        console.error("Restart request failed:", err);
        setApplyError(
          err instanceof Error ? err.message : "Failed to restart the device",
        );
        applyPendingRef.current = false;
        setIsApplying(false);
      });
    }
  }, [clearOtaProgress, kind, reloadOnly]);

  if (isInfoLoading && !currentVersion) {
    return (
      <div className="space-y-6">
        <StatusRow spinning>Loading…</StatusRow>
      </div>
    );
  }

  if (isActive) {
    const pct = Math.max(0, Math.min(100, Math.round(percent || 0)));
    const label = progressLabel(phase, asset);
    return (
      <div className="space-y-6">
        <UpdateCard
          icon={<SettingsUpdateIcon className="h-10 w-10 text-white" />}
          title={
            updateVersion ? `Nocturne ${updateVersion}` : "Updating Nocturne"
          }
          date={releaseDate(updateVersion)}
          description={RELEASE_NOTES}
          footer={
            <>
              <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-gray-700">
                <div
                  className="h-full rounded-full bg-white transition-all duration-300 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-4 mb-2 text-[16px] font-[520] text-white/50 tracking-tight">
                {label}
              </div>
            </>
          }
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <UpdateCard
          icon={<AlertCircleIcon className="h-10 w-10 text-red-400" />}
          title="Update failed"
          description={
            error.msg || error.code || "Something went wrong while updating."
          }
        />
        <ActionButton
          onClick={() => {
            dismissError();
            if (error.code === "installRequestFailed" && available) {
              handleInstall();
            } else {
              handleCheck();
            }
          }}
        >
          Try Again
        </ActionButton>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div className="space-y-6">
        <UpdateCard
          icon={<CheckCircleIcon className="h-10 w-10 text-green-400" />}
          title={
            updateVersion ? `Nocturne ${updateVersion}` : "Update complete"
          }
          date={releaseDate(updateVersion)}
          description={
            reloadOnly
              ? "Reload to finish applying this update."
              : "Restart to finish applying this update."
          }
        />
        {applyError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-red-100"
          >
            <AlertCircleIcon className="mt-0.5 h-6 w-6 shrink-0" />
            <span className="text-[18px] font-[520] leading-snug">
              {applyError}
            </span>
          </div>
        )}
        <ActionButton onClick={applyUpdate} disabled={isApplying}>
          {isApplying
            ? reloadOnly
              ? "Reloading…"
              : "Restarting…"
            : reloadOnly
              ? "Reload"
              : "Restart"}
        </ActionButton>
      </div>
    );
  }

  if (available) {
    return (
      <div className="space-y-6">
        <UpdateCard
          icon={<SettingsUpdateIcon className="h-10 w-10 text-white" />}
          title={
            available.version
              ? `Nocturne ${available.version}`
              : "Update available"
          }
          date={releaseDate(available.version)}
          description={
            available.requiresReflash
              ? "This update must be installed by reflashing with a computer."
              : RELEASE_NOTES
          }
        />
        {available.requiresReflash ? (
          <StatusRow>Reflash required</StatusRow>
        ) : isInstallPending ? (
          <StatusRow spinning>Starting update…</StatusRow>
        ) : (
          <ActionButton onClick={handleInstall}>
            Download &amp; Install
          </ActionButton>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <UpdateCard
        icon={<CheckCircleIcon className="h-10 w-10 text-green-400" />}
        title={currentVersion ? `Nocturne ${currentVersion}` : "Nocturne"}
        date={releaseDate(currentVersion)}
        description={
          lastCheckResult === "upToDate"
            ? "You're on the latest version."
            : null
        }
      />
      {isChecking ? (
        <StatusRow spinning>Checking for updates…</StatusRow>
      ) : (
        <ActionButton onClick={handleCheck}>Check for Updates</ActionButton>
      )}
    </div>
  );
};

export default SoftwareUpdate;
