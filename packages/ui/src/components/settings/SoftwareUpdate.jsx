import React, { useEffect, useState, useRef, useCallback } from "react";
import { SettingsUpdateIcon, CheckCircleIcon, RefreshIcon } from "../common/icons";
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

  const [showFullDescription, setShowFullDescription] = useState(false);

  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  const formatDescription = (text) => {
    if (!text) return null;
    
    return text.split('\n').map((line, index) => {
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('* ') || trimmedLine.startsWith('- ')) {
        return (
          <div key={index} className="flex items-start">
            <span className="mr-2 mt-1">•</span>
            <span>{trimmedLine.substring(2)}</span>
          </div>
        );
      }
      
      if (trimmedLine === '') {
        return <div key={index} className="h-2" />;
      }
      
      return <div key={index}>{trimmedLine}</div>;
    });
  };

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
      {(isChecking || !hasUpdate) && (
        <div className="space-y-4">
          <div className="p-1.5 bg-white/10 rounded-xl border border-white/10">
            <div className="flex flex-col items-center justify-center text-center py-8">
              <div className="space-y-2 flex flex-col items-center">
                <div className="flex justify-center">
                  <CheckCircleIcon className="w-16 h-16 text-green-400" />
                </div>
                <div className="text-[28px] font-[580] text-white tracking-tight">
                  {name} is up to date
                </div>
                <div className="text-[24px] font-[560] text-white/80 tracking-tight">
                  Version {currentVersion}
                </div>
              </div>
            </div>
          </div>
          
          <button
            onClick={isChecking ? undefined : checkForUpdates}
            disabled={isChecking}
            className={`w-full p-4 rounded-xl border focus:outline-none transition-colors duration-200 flex items-center justify-center ${
              isChecking
                ? "bg-white/5 border-white/5 text-white/40 cursor-not-allowed"
                : "bg-white/10 hover:bg-white/20 border-white/10 text-white"
            }`}
          >
            <RefreshIcon className={`w-7 h-7 mr-2 ${isChecking ? "animate-spin" : ""}`} />
            <span className="text-[28px] font-[580] text-white tracking-tight">
              {isChecking ? "Checking for updates..." : "Check for Updates"}
            </span>
          </button>
        </div>
      )}

      {hasUpdate && (
        <div className="space-y-4">
          <div className="p-4 bg-white/10 rounded-xl border border-white/10">
            <div className="flex items-center mb-4">
              <img
                src={imagePath}
                alt={`${name} ${latestVersion}`}
                className="w-16 h-16 rounded-xl object-cover"
              />
              <div className="ml-4">
                <div className="text-[28px] font-[580] text-white tracking-tight">
                  {name} {latestVersion}
                </div>
                <div className="text-[20px] font-[560] text-white/80 tracking-tight">
                  {formatBytes(updateInfo?.releaseSize || 0)} • {updateInfo?.releaseDate.split('T')[0]}
                </div>
              </div>
            </div>

            {isMultiStepUpdate && (
              <div className="mb-4 px-4 py-3 bg-blue-600/20 border border-blue-400/30 rounded-lg">
                <div className="text-[20px] font-[580] text-blue-300">
                  Multiple Updates Required
                </div>
                <div className="text-[18px] text-blue-200/80">
                  Your system needs {totalUpdates} updates to reach version {finalVersion}.
                </div>
              </div>
            )}

            <div className="space-y-3 text-[24px] font-[560] text-white/80 tracking-tight">
              <div className="space-y-2">
                {formatDescription(showFullDescription ? updateInfo?.fullDescription : updateInfo?.shortDescription)}
              </div>
              {updateInfo?.fullDescription && updateInfo?.fullDescription !== updateInfo?.shortDescription && (
                <button
                  onClick={() => setShowFullDescription(!showFullDescription)}
                  className="text-blue-400 hover:text-blue-300 transition-colors text-[20px] font-[560]"
                  style={{ background: 'none' }}
                >
                  {showFullDescription ? 'Show less' : 'Read more'}
                </button>
              )}
            </div>

            {noCompatiblePath && (
              <div className="mt-4 p-3 bg-amber-600/20 border border-amber-400/30 rounded-lg">
                <div className="text-[20px] font-[580] text-amber-400">
                  No Compatible Update Path
                </div>
                <div className="text-[18px] text-amber-300/80">
                  There's no direct update path from your current version. Please manually update to the latest version using a computer.
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
                Download and Install
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
            ? `Downloading Update (Update ${currentStep} of ${totalSteps})`
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
