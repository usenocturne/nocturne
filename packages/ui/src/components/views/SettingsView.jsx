import React from "react";

const SettingsView = ({ accessToken }) => {
  return (
    <div className="p-10">
      <h2 className="text-4xl text-white font-[580]">Settings</h2>
      <p className="text-white/60 text-xl mt-4">
        App settings will appear here.
      </p>
    </div>
  );
};

export default SettingsView;
