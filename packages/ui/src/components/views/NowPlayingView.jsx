import React from "react";

const NowPlayingView = ({ accessToken }) => {
  return (
    <div className="p-10">
      <h2 className="text-4xl text-white font-[580]">Now Playing</h2>
      <p className="text-white/60 text-xl mt-4">
        Current track information will appear here.
      </p>
    </div>
  );
};

export default NowPlayingView;
