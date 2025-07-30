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

  useEffect(() => {
    if (stage === "complete" && countdown === null) {
      setCountdown(10);
    }
  }, [stage, countdown]);

  useEffect(() => {
    if (countdown === null) return;

    if (countdown === 0) {
      fetch("http://localhost:5000/device/power/reboot", { method: "POST" }).catch(
        (err) => console.error("Reboot request failed", err),
      );
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
  const displayPercent = stage === "complete" && countdown !== null
    ? countdown * 10
    : percent;
  const bytesCompleteMB = updateProgress.bytesComplete
    ? Math.round(updateProgress.bytesComplete / 1024 / 1024)
    : 0;
  const bytesTotalMB = updateProgress.bytesTotal
    ? Math.round(updateProgress.bytesTotal / 1024 / 1024)
    : 0;
  const speed = updateProgress.speed ? updateProgress.speed.toFixed(2) : "0";

  const isStageComplete = stage === "complete";

  useEffect(() => {
    updateGradientColors(null, "auth");
  }, [updateGradientColors]);

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
              style={{ width: `${displayPercent}%`, transition: "width 0.3s ease" }}
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
              <span className="absolute right-0">{speed} MB/s</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UpdateScreen; 