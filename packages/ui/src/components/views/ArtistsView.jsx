import React from "react";

const ArtistsView = ({ accessToken }) => {
  return (
    <div className="p-10">
      <h2 className="text-4xl text-white font-[580]">Artists</h2>
      <p className="text-white/60 text-xl mt-4">
        Your favorite artists will appear here.
      </p>
    </div>
  );
};

export default ArtistsView;
