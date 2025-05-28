import React, { useEffect, useState, useRef, useCallback } from "react";
import { SettingsUpdateIcon, CheckCircleIcon } from "../common/icons";
import { useConnector } from "../../contexts/ConnectorContext";
import { useSystemUpdate } from "../../hooks/useNocturned";
import { useUpdateCheck } from "../../hooks/useUpdateCheck";

const SoftwareUpdate = ({
  nocturneCurrentVersion = "3.0.0",
}) => {
  const { isConnectorAvailable } = useConnector();
  const {
    updateStatus,
    progress,
    isUpdating,
    isError,
    errorMessage,
    startUpdate
  } = useSystemUpdate();

  const {
    updateInfo,
    isChecking,
    error: checkError,
    lastChecked,
    checkForUpdates,
    advanceUpdateChain,
    updateChain
  } = useUpdateCheck(nocturneCurrentVersion);

  const [releaseNotes, setReleaseNotes] = useState([]);

  useEffect(() => {
    if (updateInfo?.releaseNotes) {
      const notes = updateInfo.releaseNotes
        .split('\n')
        .filter(line => line.trim().startsWith('*') || line.trim().startsWith('-'))
        .map(line => line.trim().substring(1).trim())
        .filter(line => line.length > 0)
        .slice(0, 5);

      setReleaseNotes(notes.length > 0 ? notes : ['New version available']);
    }
  }, [updateInfo]);

  const handleUpdateChainAdvance = useCallback(() => {
    if (!isUpdating && !isError && updateStatus.stage === 'complete' && updateInfo?.nextInChain) {
      advanceUpdateChain();
    }
  }, [isUpdating, isError, updateStatus, updateInfo, advanceUpdateChain]);

  useEffect(() => {
    handleUpdateChainAdvance();
  }, [handleUpdateChainAdvance]);

  const hasNocturneUpdate = updateInfo?.hasUpdate || false;
  const nocturneLatestVersion = updateInfo?.version || nocturneCurrentVersion;
  const isDownloading = isUpdating && updateStatus.stage === 'download';
  const canUpdate = updateInfo?.canUpdate !== false;
  const isMultiStepUpdate = updateInfo?.nextInChain === true;
  const totalUpdates = updateInfo?.totalUpdates || 0;
  const noCompatiblePath = updateInfo?.noCompatiblePath === true;

  const handleNocturneUpdate = async () => {
    if (!updateInfo || !updateInfo.assetUrls) return;

    const imageURL = updateInfo.assetUrls.update || updateInfo.assetUrls.full;
    const sumURL = updateInfo.assetUrls.updateSum || updateInfo.assetUrls.fullSum;

    if (!imageURL || !sumURL) {
      console.error('Missing update files');
      return;
    }

    await startUpdate(imageURL, sumURL);
  };

  const UpdateSection = ({
    name,
    currentVersion,
    latestVersion,
    finalVersion,
    hasUpdate,
    imagePath,
    onUpdate,
    isDownloading,
    canUpdate,
    isChecking,
    releaseNotes,
    isMultiStepUpdate,
    totalUpdates,
    currentStep,
    noCompatiblePath
  }) => (
    <div className="space-y-4">
      <div className="p-4 bg-white/10 rounded-xl border border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <img
              src={imagePath}
              alt={`${name} ${currentVersion}`}
              className="w-16 h-16 rounded-xl object-cover"
            />
            <div className="ml-4">
              <div className="text-[28px] font-[580] text-white tracking-tight">
                {name} {currentVersion}
              </div>
              <div className="flex items-center text-[24px] font-[560] tracking-tight">
                {isChecking ? (
                  <div className="flex items-center text-white/80">
                    Checking for updates...
                  </div>
                ) : hasUpdate ? (
                  <div className="flex items-center text-white/80">
                    <SettingsUpdateIcon className="w-5 h-5 mr-2" />
                    Update Available
                  </div>
                ) : (
                  <div className="flex items-center text-white/80">
                    <CheckCircleIcon className="w-5 h-5 mr-2" />
                    Up to Date
                  </div>
                )}
              </div>
            </div>
          </div>

          {!isChecking && !hasUpdate && (
            <button
              onClick={checkForUpdates}
              className="text-white/60 hover:text-white/80 text-[20px] font-[560] transition-colors"
              style={{ background: 'none' }}
            >
              Check
            </button>
          )}
        </div>
      </div>

      {hasUpdate && (
        <div className="space-y-4">
          <div className="p-4 bg-white/10 rounded-xl border border-white/10">
            <div className="text-[28px] font-[580] text-white tracking-tight mb-4">
              New Version: {isMultiStepUpdate ? `${latestVersion} (Step ${currentStep} of ${totalUpdates})` : latestVersion}
            </div>

            {isMultiStepUpdate && (
              <div className="mb-4 px-4 py-3 bg-blue-600/20 border border-blue-400/30 rounded-lg">
                <div className="text-[20px] font-[580] text-blue-300">
                  Multi-step Update Required
                </div>
                <div className="text-[18px] text-blue-200/80">
                  Your system needs {totalUpdates} sequential updates to reach version {finalVersion}.
                </div>
              </div>
            )}

            <div className="space-y-2 text-[24px] font-[560] text-white/80 tracking-tight">
              {releaseNotes.map((note, index) => (
                <div key={index}>• {note}</div>
              ))}
            </div>

            {noCompatiblePath && (
              <div className="mt-4 p-3 bg-amber-600/20 border border-amber-400/30 rounded-lg">
                <div className="text-[20px] font-[580] text-amber-400">
                  No Compatible Update Path
                </div>
                <div className="text-[18px] text-amber-300/80">
                  There's no direct update path from your current version. Please contact support.
                </div>
              </div>
            )}

            {!canUpdate && !noCompatiblePath && (
              <div className="mt-4 p-3 bg-amber-600/20 border border-amber-400/30 rounded-lg">
                <div className="text-[20px] font-[580] text-amber-400">
                  Your current version is too old for this update.
                </div>
                <div className="text-[18px] text-amber-300/80">
                  Please update to at least version {updateInfo?.minimumVersion} first.
                </div>
              </div>
            )}
          </div>

          {isDownloading ? (
            <DownloadProgressPanel
              progress={progress}
              isError={isError}
              errorMessage={errorMessage}
              isMultiStepUpdate={isMultiStepUpdate}
              currentStep={currentStep}
              totalSteps={totalUpdates}
            />
          ) : (
            <button
              className={`w-full p-4 rounded-xl border ${canUpdate
                ? "bg-white/10 hover:bg-white/20 border-white/10 text-white"
                : "bg-white/5 border-white/5 text-white/40"}`}
              onClick={canUpdate ? onUpdate : undefined}
              disabled={!canUpdate}
            >
              <span className="text-[28px] font-[580] tracking-tight">
                {isMultiStepUpdate ? `Download and Install (Step ${currentStep} of ${totalUpdates})` : "Download and Install"}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );

  const DownloadProgressPanel = ({
    progress,
    isError,
    errorMessage,
    isMultiStepUpdate,
    currentStep,
    totalSteps
  }) => {
    return (
      <div className="p-4 bg-white/10 rounded-xl border border-white/10">
        <div className="text-[28px] font-[580] text-white tracking-tight mb-2">
          {isError ? "Download Failed" : isMultiStepUpdate
            ? `Downloading Update (Step ${currentStep} of ${totalSteps})`
            : "Downloading Update"
          }
        </div>

        {isError ? (
          <div className="text-[24px] font-[560] text-red-400 tracking-tight mb-2">
            {errorMessage || "An unknown error occurred"}
          </div>
        ) : (
          <>
            <div className="w-full bg-white/10 rounded-full h-3 mb-2">
              <div
                className="bg-white h-3 rounded-full transition-all"
                style={{ width: `${progress.percent}%` }}
              ></div>
            </div>
            <div className="flex justify-between text-[18px] font-[560] text-white/80 tracking-tight">
              <span>{progress.percent}%</span>
              <span>{Math.round(progress.bytesComplete / 1024 / 1024)} MB / {Math.round(progress.bytesTotal / 1024 / 1024)} MB</span>
              <span>{progress.speed} MB/s</span>
            </div>
          </>
        )}
      </div>
    );
  };

  const getFinalVersion = () => {
    if (!updateChain || updateChain.length === 0) return nocturneLatestVersion;
    return updateChain[updateChain.length - 1].version;
  };

  return (
    <div className="space-y-6">
      <UpdateSection
        name="Nocturne"
        currentVersion={nocturneCurrentVersion}
        latestVersion={nocturneLatestVersion}
        finalVersion={getFinalVersion()}
        hasUpdate={hasNocturneUpdate}
        imagePath="/images/os/nocturne/3.0.0.webp"
        onUpdate={handleNocturneUpdate}
        isDownloading={isDownloading}
        canUpdate={canUpdate}
        isChecking={isChecking}
        releaseNotes={releaseNotes}
        isMultiStepUpdate={isMultiStepUpdate}
        totalUpdates={totalUpdates}
        currentStep={1}
        noCompatiblePath={noCompatiblePath}
      />

      {isConnectorAvailable && (
        <div className="p-4 bg-white/10 rounded-xl border border-white/10">
          <div className="text-[28px] font-[580] text-white tracking-tight mb-2">
            Connector Updates
          </div>
          <div className="text-[24px] font-[560] text-white/80 tracking-tight">
            Connector updates are managed separately.
          </div>
        </div>
      )}
    </div>
  );
};

export default SoftwareUpdate;
