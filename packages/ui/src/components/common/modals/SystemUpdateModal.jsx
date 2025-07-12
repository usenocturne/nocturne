import React from "react";

export default function SystemUpdateModal({
  show,
  status,
  progress,
  isError,
  errorMessage,
}) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[#1A1A1A] rounded-2xl p-8 w-[500px] shadow-lg">
        <h2 className="text-3xl font-semibold text-white mb-4">
          {isError ? "Update Failed" : "System Update in Progress"}
        </h2>

        {isError ? (
          <div className="space-y-6">
            <p className="text-xl text-red-400">
              {errorMessage ||
                "An unknown error occurred while updating your system."}
            </p>
            <p className="text-lg text-white/80">
              Please try again later or ask in our Discord if the problem
              persists.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-xl text-white/80 mb-4">
              {status.stage === "flash"
                ? "Installing system update. Please do not remove power from your device."
                : "Preparing update files. This may take a few minutes."}
            </p>

            <div className="space-y-2">
              <div className="w-full bg-white/10 rounded-full h-4">
                <div
                  className="bg-white h-4 rounded-full transition-all"
                  style={{ width: `${progress.percent}%` }}
                ></div>
              </div>

              <div className="flex justify-between text-lg text-white/80">
                <span>{Math.round(progress.percent)}%</span>
                <span>
                  {Math.round(progress.bytesComplete / 1024 / 1024)} MB /{" "}
                  {Math.round(progress.bytesTotal / 1024 / 1024)} MB
                </span>
                <span>{progress.speed} MB/s</span>
              </div>
            </div>

            {status.stage === "flash" && (
              <p className="text-amber-400 text-lg">
                Your system will automatically restart when the update is
                complete.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
