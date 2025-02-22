import React from "react";
import { SettingsUpdateIcon, CheckCircleIcon } from "../icons";

const SoftwareUpdate = ({
  nocturneCurrentVersion = "3.0.0",
  nocturneLatestVersion = "3.0.0",
  connectorCurrentVersion = "1.0.0",
  connectorLatestVersion = "1.0.0",
}) => {
  const hasNocturneUpdate = nocturneCurrentVersion !== nocturneLatestVersion;
  const hasConnectorUpdate = connectorCurrentVersion !== connectorLatestVersion;

  const UpdateSection = ({
    name,
    currentVersion,
    latestVersion,
    hasUpdate,
    imagePath,
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
                {hasUpdate ? (
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
        </div>
      </div>

      {hasUpdate && (
        <div className="space-y-4">
          <div className="p-4 bg-white/10 rounded-xl border border-white/10">
            <div className="text-[28px] font-[580] text-white tracking-tight mb-4">
              New Version: {latestVersion}
            </div>
            <div className="space-y-2 text-[24px] font-[560] text-white/80 tracking-tight">
              <div>• Feature 1</div>
              <div>• Feature 2</div>
              <div>• Feature 3</div>
            </div>
          </div>

          <button className="w-full p-4 bg-white/10 hover:bg-white/20 transition-colors rounded-xl border border-white/10">
            <span className="text-[28px] font-[580] text-white tracking-tight">
              Download and Install
            </span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className={`space-y-${hasNocturneUpdate ? "6" : "4"}`}>
      <UpdateSection
        name="Nocturne"
        currentVersion={nocturneCurrentVersion}
        latestVersion={nocturneLatestVersion}
        hasUpdate={hasNocturneUpdate}
        imagePath="/images/os/nocturne/3.0.0.webp"
      />

      <UpdateSection
        name="Connector"
        currentVersion={connectorCurrentVersion}
        latestVersion={connectorLatestVersion}
        hasUpdate={hasConnectorUpdate}
        imagePath="/images/os/connector/1.0.0.webp"
      />
    </div>
  );
};

export default SoftwareUpdate;
