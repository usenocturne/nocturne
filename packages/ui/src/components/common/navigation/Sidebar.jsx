import Link from "next/link";
import { useEffect, useState } from "react";
import {
  NowPlayingIcon,
  RecentsIcon,
  LibraryIcon,
  ArtistsIcon,
  RadioIcon,
  SettingsIcon,
} from "../../icons";
import StatusBar from "./StatusBar";

export default function Sidebar({ activeSection, setActiveSection }) {
  const handleSectionClick = (section) => {
    setActiveSection(section);
  };

  const SidebarItem = ({ section, icon: Icon, label }) => (
    <div
      className="relative flex items-center cursor-pointer group"
      onClick={() => handleSectionClick(section)}
    >
      {activeSection === section && (
        <div
          className="absolute left-[-19px] top-1/2 transform -translate-y-1/2 h-8 w-1.5 bg-white rounded-full"
          aria-hidden="true"
        />
      )}
      <div className="mr-4 flex-shrink-0">
        <div className="h-[70px] w-[70px] bg-white/25 rounded-[12px] flex items-center justify-center">
          <Icon className="h-10 w-10" />
        </div>
      </div>
      <div>
        <h4 className="ml-1 text-[32px] font-[580] text-white tracking-tight">
          {label}
        </h4>
      </div>
    </div>
  );

  return (
    <div className="space-y-7 pt-12">
      <StatusBar />
      <Link href={`/now-playing`}>
        <div className="relative flex items-center">
          <div className="mr-4 flex-shrink-0">
            <div className="h-[70px] w-[70px] bg-white/25 rounded-[12px] flex items-center justify-center">
              <NowPlayingIcon className="h-10 w-10" />
            </div>
          </div>
          <div>
            <h4 className="ml-1 text-[32px] font-[580] text-white tracking-tight">
              Now Playing
            </h4>
          </div>
        </div>
      </Link>

      <SidebarItem section="recents" icon={RecentsIcon} label="Recents" />
      <SidebarItem section="library" icon={LibraryIcon} label="Library" />
      <SidebarItem section="artists" icon={ArtistsIcon} label="Artists" />
      <SidebarItem section="radio" icon={RadioIcon} label="Radio" />
      <SidebarItem section="settings" icon={SettingsIcon} label="Settings" />
    </div>
  );
}
