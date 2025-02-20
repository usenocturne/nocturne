import React from "react";
import { SettingsUpdateIcon, CheckCircleIcon } from "../icons";

const SoftwareUpdate = ({
  currentVersion = "3.0.0",
  latestVersion = "3.0.0",
}) => {
  const hasUpdate = currentVersion !== latestVersion;

  return (
    <div className="space-y-6">
      <div className="p-4 bg-white/10 rounded-xl border border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <img
              src="/images/os/3.0.0.webp"
              alt="Nocturne 3.0.0"
              className="w-16 h-16 object-cover"
            />
            <div className="ml-4">
              <div className="text-[28px] font-[580] text-white tracking-tight">
                Nocturne {currentVersion}
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
};

export default SoftwareUpdate;
