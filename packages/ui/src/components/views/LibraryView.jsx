import React from "react";

const LibraryView = ({ accessToken }) => {
  return (
    <div className="p-10">
      <h2 className="text-4xl text-white font-[580]">Library</h2>
      <p className="text-white/60 text-xl mt-4">
        Your playlists and saved content will appear here.
      </p>
    </div>
  );
};

export default LibraryView;
