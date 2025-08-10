import React, { useEffect, useState, useRef } from "react";
import { useGradientState } from "../../hooks/useGradientState";
import { useSystemUpdate } from "../../hooks/useNocturned";
import NocturneIcon from "./icons/NocturneIcon";
import GradientBackground from "./GradientBackground";
import FontLoader from "./FontLoader";

const UpdateScreen = () => {
  const [gradientState, updateGradientColors] = useGradientState();
  const {
    progress: updateProgress,
    isUpdating,
    isError,
    errorMessage,
    updateStatus,
  } = useSystemUpdate();

  const stage = updateStatus?.stage || "download";

  const [countdown, setCountdown] = useState(null);
  const countdownRef = useRef(null);
  const [etaSeconds, setEtaSeconds] = useState(null);
  const lastBytesRef = useRef(null);
  const lastTimeRef = useRef(null);
  const lastPercentRef = useRef(null);
  const samplesRef = useRef([]);
  const WINDOW_SECONDS = 10;

  useEffect(() => {
    if (stage === "complete" && countdown === null) {
      setCountdown(10);
    }
  }, [stage, countdown]);

  useEffect(() => {
    if (countdown === null) return;

    if (countdown === 0) {
      fetch("http://localhost:5000/device/power/reboot", {
        method: "POST",
      }).catch((err) => console.error("Reboot request failed", err));
      return;
    }

    countdownRef.current = setTimeout(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(countdownRef.current);
  }, [countdown]);

  let title = "Update in Progress";
  let description = "Keep your Car Thing plugged in and connected to power.";

  if (isError) {
    title = stage === "flash" ? "Installation Failed" : "Download Failed";
    description = errorMessage || "An unknown error occurred.";
  } else {
    if (stage === "flash") {
      title = "Installing Update";
    } else if (stage === "complete") {
      title = "Update Complete";
      description = `Your Car Thing will reboot in ${countdown ?? 10} seconds.`;
    } else {
      title = "Downloading Update";
    }
  }

  const percent = Math.min(updateProgress.percent || 0, 100);
  const displayPercent =
    stage === "complete" && countdown !== null ? countdown * 10 : percent;
  const bytesCompleteMB = updateProgress.bytesComplete
    ? Math.round(updateProgress.bytesComplete / 1024 / 1024)
    : 0;
  const bytesTotalMB = updateProgress.bytesTotal
    ? Math.round(updateProgress.bytesTotal / 1024 / 1024)
    : 0;
  const reportedSpeed =
    typeof updateProgress.speed === "number" ? updateProgress.speed : 0;
  const reportedSpeedText =
    reportedSpeed > 0 ? `${reportedSpeed.toFixed(2)} MB/s` : null;

  const isStageComplete = stage === "complete";

  useEffect(() => {
    updateGradientColors(null, "auth");
  }, [updateGradientColors]);

  useEffect(() => {
    if (isStageComplete) {
      setEtaSeconds(null);
      lastBytesRef.current = null;
      lastTimeRef.current = null;
      lastPercentRef.current = null;
      samplesRef.current = [];
      return;
    }

    const now = Date.now();
    const bytesComplete = updateProgress.bytesComplete || 0;
    const bytesTotal = updateProgress.bytesTotal || 0;
    const remainingBytes = Math.max(bytesTotal - bytesComplete, 0);

    const arr = samplesRef.current;
    arr.push({ t: now, bytes: bytesComplete });
    const cutoff = now - WINDOW_SECONDS * 1000;
    while (arr.length > 1 && arr[0].t < cutoff) arr.shift();

    let speedMBps = 0;
    if (arr.length >= 2) {
      const first = arr[0];
      const last = arr[arr.length - 1];
      const deltaBytes = Math.max(last.bytes - first.bytes, 0);
      const deltaSec = Math.max((last.t - first.t) / 1000, 0.001);
      speedMBps = deltaBytes / 1024 / 1024 / deltaSec;
    }

    if (speedMBps <= 0 && reportedSpeed > 0) {
      speedMBps = reportedSpeed;
    }

    let eta = null;
    if (bytesTotal > 0 && speedMBps > 0 && remainingBytes > 0) {
      const remainingMB = remainingBytes / 1024 / 1024;
      eta = remainingMB / speedMBps;
    } else {
      const prev = lastPercentRef.current;
      if (prev && prev.time && typeof prev.value === "number") {
        const deltaSec = (now - prev.time) / 1000;
        const deltaPercent = percent - prev.value;
        if (deltaSec > 0 && deltaPercent > 0) {
          const ratePercentPerSec = deltaPercent / deltaSec;
          eta = (100 - percent) / ratePercentPerSec;
        }
      }
    }

    const validEta = Number.isFinite(eta) && eta > 0 && eta < 24 * 3600;
    setEtaSeconds(validEta ? eta : null);
    lastBytesRef.current = bytesComplete;
    lastTimeRef.current = now;
    lastPercentRef.current = { value: percent, time: now };
  }, [updateProgress, percent, isStageComplete, reportedSpeed]);

  const formatETA = (seconds) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const s = Math.round(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")} left`;
    }
    return `${mins}:${String(secs).padStart(2, "0")} left`;
  };

  return (
    <div className="h-screen flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl">
      <FontLoader />
      <GradientBackground gradientState={gradientState} />
      <div className="relative z-10 w-full max-w-6xl px-6 grid grid-cols-1 gap-4 items-center">
        <div className="flex flex-col items-start space-y-8 ml-12">
          <NocturneIcon className="h-12 w-auto" />
          <div className="space-y-4">
            <h2 className="text-5xl text-white tracking-tight font-[600] whitespace-nowrap max-w-full">
              {title}
            </h2>
            <p className="text-[30px] text-white/70 font-[560] tracking-tight w-[24rem]">
              {description}
            </p>
          </div>
        </div>
        <div className="mt-8 mx-12">
          <div className="relative w-full h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="absolute left-0 top-0 h-full bg-white rounded-full"
              style={{
                width: `${displayPercent}%`,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div className="relative mt-2 text-white/60 text-[20px] tracking-tight w-full">
            {!isStageComplete && (
              <span className="absolute left-0">{displayPercent}%</span>
            )}
            {!isStageComplete && (
              <span className="absolute left-1/2 -translate-x-1/2">
                {`${bytesCompleteMB} MB / ${bytesTotalMB || "--"} MB`}
              </span>
            )}
            {!isStageComplete && (
              <span className="absolute right-0">
                {formatETA(etaSeconds) || reportedSpeedText || "--"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UpdateScreen;
