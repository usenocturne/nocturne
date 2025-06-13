import React, { useState, useEffect, useRef } from "react";
import { Switch } from "@headlessui/react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SettingsAccountIcon,
  SettingsUpdateIcon,
  SettingsCreditsIcon,
  SettingsGeneralIcon,
  SettingsPlaybackIcon,
  SettingsSupportIcon,
  BluetoothIcon,
  WifiMaxIcon,
} from "../common/icons";
import AccountInfo from "./AccountInfo";
import SoftwareUpdate from "./SoftwareUpdate";
import WiFiNetworks from "./network/WiFiNetworks";
import BluetoothDevices from "./network/BluetoothDevices";
import { useSettings } from "../../contexts/SettingsContext";

const settingsStructure = {
  general: {
    title: "General",
    icon: SettingsGeneralIcon,
    items: [
      {
        id: "start-with-now-playing",
        title: "Start with Now Playing",
        type: "toggle",
        description:
          "When enabled, the app will open directly to Now Playing instead of Recents when you start it.",
        storageKey: "startWithNowPlaying",
        defaultValue: false,
      },
      {
        id: "show-status-bar",
        title: "Toggle Status Bar",
        type: "toggle",
        description: "Show or hide the status bar at the top of the sidebar.",
        storageKey: "showStatusBar",
        defaultValue: true,
      },
      {
        id: "24-hour-time",
        title: "24-Hour Time",
        type: "toggle",
        description:
          "Display the clock inside of the status bar in 24-hour format instead of 12-hour format.",
        storageKey: "use24HourTime",
        defaultValue: false,
      },
    ],
  },
  update: {
    title: "Software Update",
    icon: SettingsUpdateIcon,
    items: [
      {
        id: "software-update",
        type: "custom",
        component: SoftwareUpdate,
      },
    ],
  },
  network: {
    title: "Network",
    icon: WifiMaxIcon,
    type: "parent",
    items: [
      {
        id: "wifi",
        title: "Wi-Fi",
        icon: WifiMaxIcon,
        subpage: {
          type: "custom",
          component: WiFiNetworks,
        },
      },
      {
        id: "bluetooth",
        title: "Bluetooth",
        icon: BluetoothIcon,
        subpage: {
          type: "custom",
          component: BluetoothDevices,
        },
      },
    ],
  },
  playback: {
    title: "Playback",
    icon: SettingsPlaybackIcon,
    items: [
      {
        id: "track-scrolling",
        title: "Track Name Scrolling",
        type: "toggle",
        description:
          "Enable or disable the scrolling animation for the track name in the player.",
        storageKey: "trackNameScrollingEnabled",
        defaultValue: true,
      },
      {
        id: "show-lyrics-gesture",
        title: "Swipe to Show Lyrics",
        type: "toggle",
        description:
          "Enable swiping up on the track info to show the lyrics of a song.",
        storageKey: "showLyricsGestureEnabled",
        defaultValue: false,
      },
      {
        id: "song-change-gesture",
        title: "Swipe to Change Song",
        type: "toggle",
        description:
          "Enable left/right swipe gestures to skip to the previous or next song.",
        storageKey: "songChangeGestureEnabled",
        defaultValue: true,
      },
      {
        id: "elapsed-time",
        title: "Show Time Elapsed",
        type: "toggle",
        description:
          "Display the elapsed track time below the progress bar.",
        storageKey: "elapsedTimeEnabled",
        defaultValue: false,
      },
    ],
  },
  account: {
    title: "Account",
    icon: SettingsAccountIcon,
    items: [
      {
        id: "profile-info",
        title: "Profile Information",
        type: "custom",
      },
      {
        id: "sign-out",
        title: "Sign Out",
        type: "action",
        description: "Sign out out of Nocturne and reset all settings.",
        action: "signOut",
      },
    ],
  },
  support: {
    title: "Support Nocturne",
    icon: SettingsSupportIcon,
  },
  credits: {
    title: "Credits",
    icon: SettingsCreditsIcon,
    type: "custom",
    items: [
      {
        id: "developers",
        title: "Developers",
        type: "sponsors",
        names: ["Brandon Saldan", "bbaovanc", "Dominic Frye", "shadow"],
      },
      {
        id: "contributors",
        title: "Contributors",
        type: "sponsors",
        names: ["angelolz", "EllEation", "Jenner Gray", "vakst"],
      },
      {
        id: "sponsors",
        title: "Sponsors",
        type: "sponsors",
        names: [
          "Canaan.0",
          "Cbb",
          "danielvaswani",
          "DeanGulBairy",
          "DeepfakeKittens",
          "Garrett Webb",
          "HarpMudd",
          "itsamanpret",
          "Jenner Gray",
          "MaydaySilly",
          "Nathan",
          "Navi",
          "nono9k",
          "Tanner",
          "uktexan",
          "Vonnieboo",
          "Yungguap",
        ],
      },
    ],
  },
};

const clearSettings = () => {
  for (const categoryKey in settingsStructure) {
    const category = settingsStructure[categoryKey];
    if (category.items) {
      for (const item of category.items) {
        if (item.storageKey) {
          localStorage.removeItem(item.storageKey);
        }
      }
    }
  }
};

export default function Settings({
  accessToken,
  onOpenDonationModal,
  setActiveSection,
}) {
  const navigate = useNavigate();
  const [userProfile, setUserProfile] = useState(null);
  const [versionInfo, setVersionInfo] = useState("Loading versions...");
  const [activeParent, setActiveParent] = useState(null);
  const [activeSubItem, setActiveSubItem] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const shouldExitToRecents = useRef(false);
  const isProcessingEscape = useRef(false);
  const scrollContainerRef = useRef(null);
  const { settings, updateSetting } = useSettings();

  const [showMain, setShowMain] = useState(true);
  const [showParent, setShowParent] = useState(false);
  const [showSubpage, setShowSubpage] = useState(false);

  const [mainClasses, setMainClasses] = useState("translate-x-0 opacity-100");
  const [parentClasses, setParentClasses] = useState(
    "translate-x-full opacity-0"
  );
  const [subpageClasses, setSubpageClasses] = useState(
    "translate-x-full opacity-0"
  );

  const ANIMATION_DURATION = 300;

  useEffect(() => {
    scrollContainerRef.current = document.querySelector(
      ".settings-scroll-container"
    );
  }, []);

  useEffect(() => {
    setTimeout(() => {
      setVersionInfo("Client version: 3.0.0\nOS version: 1.0.0");
    }, 1000);

    if (accessToken) {
      fetchSpotifyProfile();
    }
  }, [accessToken]);

  const fetchSpotifyProfile = async () => {
    try {
      const response = await fetch("https://api.spotify.com/v1/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const profile = await response.json();
      setUserProfile(profile);
    } catch (error) {
      console.error("Error fetching Spotify profile:", error);
    }
  };

  const handleToggle = (key) => {
    updateSetting(key, !settings[key]);
  };

  const handleSignOut = async () => {
    try {
      localStorage.removeItem("spotifyAccessToken");
      localStorage.removeItem("spotifyRefreshToken");
      localStorage.removeItem("spotifyTokenExpiry");
      localStorage.removeItem("spotifyAuthType");
      clearSettings();
      window.location.reload();
    } catch (error) {
      console.error("Error during sign out:", error);
      localStorage.clear();
      window.location.reload();
    }
  };

  const handleAction = (action) => {
    switch (action) {
      case "signOut":
        handleSignOut();
        break;
      case "openDonation":
        onOpenDonationModal();
        break;
    }
  };

  const navigateTo = (page, subItem = null) => {
    if (isAnimating) return;
    setIsAnimating(true);
    shouldExitToRecents.current = false;

    if (showMain) {
      setMainClasses("-translate-x-full opacity-0");
      setParentClasses("translate-x-0 opacity-100");
      setActiveParent(page);

      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0;
        }
      }, ANIMATION_DURATION / 3);

      setTimeout(() => {
        setShowMain(false);
        setShowParent(true);
        setIsAnimating(false);

        if (subItem) {
          setTimeout(() => {
            navigateTo(page, subItem);
          }, 50);
        }
      }, ANIMATION_DURATION);
    } else if (showParent && subItem) {
      setParentClasses("-translate-x-full opacity-0");
      setSubpageClasses("translate-x-0 opacity-100");
      setActiveSubItem(subItem);

      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0;
        }
      }, ANIMATION_DURATION / 3);

      setTimeout(() => {
        setShowParent(false);
        setShowSubpage(true);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    }
  };

  const navigateBack = () => {
    if (isAnimating) return;
    setIsAnimating(true);

    if (showSubpage) {
      setSubpageClasses("translate-x-full opacity-0");
      setParentClasses("translate-x-0 opacity-100");

      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0;
        }
      }, ANIMATION_DURATION / 3);

      setTimeout(() => {
        setShowSubpage(false);
        setShowParent(true);
        setActiveSubItem(null);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    } else if (showParent) {
      setParentClasses("translate-x-full opacity-0");
      setMainClasses("translate-x-0 opacity-100");

      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0;
        }
      }, ANIMATION_DURATION / 3);

      setTimeout(() => {
        setShowParent(false);
        setShowMain(true);
        setActiveParent(null);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    }
  };

  const renderSettingItem = (item) => {
    if (item.subpage) {
      const SubpageComponent = item.subpage.component;
      return <SubpageComponent key={item.id} />;
    }

    switch (item.type) {
      case "toggle":
        return (
          <div key={item.id} className="mb-8">
            <div className="flex items-center">
              <Switch
                checked={settings[item.storageKey]}
                onChange={() => handleToggle(item.storageKey)}
                className={`relative inline-flex h-11 w-20 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${settings[item.storageKey] ? "bg-white/40" : "bg-white/10"
                  }`}
              >
                <span
                  className={`pointer-events-none inline-block h-10 w-10 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings[item.storageKey]
                      ? "translate-x-9"
                      : "translate-x-0"
                    }`}
                />
              </Switch>
              <span className="ml-3 text-[32px] font-[580] text-white tracking-tight">
                {item.title}
              </span>
            </div>
            <p className="pt-4 text-[28px] font-[560] text-white/60 max-w-[380px] tracking-tight">
              {item.description}
            </p>
          </div>
        );
      case "action":
        return (
          <div key={item.id} className="mb-8">
            <button
              onClick={() => handleAction(item.action)}
              className="bg-white/10 hover:bg-white/20 w-80 transition-colors duration-200 rounded-[12px] px-6 py-3 border border-white/10"
            >
              <span className="text-[32px] font-[580] text-white tracking-tight">
                {item.title}
              </span>
            </button>
            <p className="pt-4 text-[28px] font-[560] text-white/60 max-w-[380px] tracking-tight">
              {item.description}
            </p>
          </div>
        );
      case "sponsors":
        return (
          <div key={item.id} className="mb-8">
            <h3 className="text-[32px] font-[580] text-white tracking-tight mb-4">
              {item.title}
            </h3>
            <div className="space-y-2">
              {item.names.map((name, index) => (
                <p
                  key={`${item.id}-${index}`}
                  className="text-[28px] font-[560] text-white/60 tracking-tight"
                >
                  {name}
                </p>
              ))}
            </div>
          </div>
        );
      case "info":
        return (
          <div key={item.id} className="mb-8">
            <p className="text-[20px] font-[560] text-white/60 max-w-[380px] tracking-tight whitespace-pre-line">
              {item.id === "nocturne-version" ? versionInfo : item.description}
            </p>
          </div>
        );
      case "custom":
        if (item.component) {
          const Component = item.component;
          return <Component key={item.id} />;
        } else if (item.id === "profile-info") {
          return <AccountInfo key={item.id} userProfile={userProfile} />;
        }
        return null;
      default:
        return null;
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isAnimating) return;
      
      if (e.key === "Escape") {
        if (showSubpage) {
          navigateBack();
        } else if (showParent) {
          navigateBack();
        } else {
          shouldExitToRecents.current = true;
          setActiveSection("recents");
        }

        setTimeout(() => {
          setIsAnimating(false);
        }, ANIMATION_DURATION);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAnimating, showSubpage, showParent, setActiveSection]);

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden settings-scroll-container" style={{ touchAction: "pan-y", overflowX: "hidden" }}>
      <style>{`
        .screen-transition {
          transition: transform ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1),
                      opacity ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1);
          will-change: transform, opacity;
        }
        .settings-scroll-container::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div className="min-h-full flex flex-col px-12 pt-12 -ml-12">
        <div className="flex-1 relative">
          <div className="relative w-full" style={{ minHeight: "100%" }}>
            <div
              className={`absolute top-0 left-0 w-full screen-transition ${mainClasses}`}
              style={{
                visibility: showMain || isAnimating ? "visible" : "hidden",
                touchAction: "pan-y",
                overflowX: "hidden",
              }}
            >
              <h2 className="text-[46px] font-[580] text-white tracking-tight mb-6">
                Settings
              </h2>
              <div className="space-y-4 mb-12">
                {Object.entries(settingsStructure).map(([key, section]) => (
                  <button
                    key={key}
                    onClick={() => {
                      if (key === "support") {
                        onOpenDonationModal();
                      } else {
                        navigateTo(key);
                      }
                    }}
                    className="flex items-center justify-between w-full p-4 bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/10"
                    disabled={isAnimating}
                  >
                    <div className="flex items-center">
                      <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center">
                        <section.icon className="w-7 h-7 text-white" />
                      </div>
                      <span className="text-[32px] ml-4 font-[580] text-white tracking-tight">
                        {section.title}
                      </span>
                    </div>
                    {key !== "support" && (
                      <ChevronRightIcon className="w-8 h-8 text-white/60" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`absolute top-0 left-0 w-full screen-transition ${parentClasses}`}
              style={{
                visibility: showParent || isAnimating ? "visible" : "hidden",
                touchAction: "pan-y",
                overflowX: "hidden",
              }}
            >
              <div className="flex items-center mb-4">
                <button
                  onClick={navigateBack}
                  className="mr-4"
                  style={{ background: 'none' }}
                  disabled={isAnimating}
                >
                  <ChevronLeftIcon className="w-8 h-8 text-white" />
                </button>
                <h2 className="text-[46px] font-[580] text-white tracking-tight">
                  {activeParent && settingsStructure[activeParent].title}
                </h2>
              </div>
              <div className="space-y-6 mb-12">
                {activeParent &&
                  settingsStructure[activeParent].type === "parent" ? (
                  <div className="space-y-4">
                    {settingsStructure[activeParent].items?.map((subItem) => (
                      <button
                        key={subItem.id}
                        onClick={() => navigateTo(activeParent, subItem)}
                        className="flex items-center justify-between w-full p-4 bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/10"
                        disabled={isAnimating}
                      >
                        <div className="flex items-center">
                          <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center">
                            <subItem.icon className="w-7 h-7 text-white" />
                          </div>
                          <span className="text-[32px] ml-4 font-[580] text-white tracking-tight">
                            {subItem.title}
                          </span>
                        </div>
                        <ChevronRightIcon className="w-8 h-8 text-white/60" />
                      </button>
                    ))}
                  </div>
                ) : (
                  activeParent &&
                  settingsStructure[activeParent].items?.map((item) =>
                    renderSettingItem(item)
                  )
                )}
              </div>
            </div>

            <div
              className={`absolute top-0 left-0 w-full screen-transition ${subpageClasses}`}
              style={{
                visibility: showSubpage || isAnimating ? "visible" : "hidden",
                touchAction: "pan-y",
                overflowX: "hidden",
              }}
            >
              <div className="flex items-center mb-4">
                <button
                  onClick={navigateBack}
                  className="mr-4"
                  style={{ background: 'none'}}
                  disabled={isAnimating}
                >
                  <ChevronLeftIcon className="w-8 h-8 text-white" />
                </button>
                <h2 className="text-[46px] font-[580] text-white tracking-tight">
                  {activeSubItem?.title}
                </h2>
              </div>
              <div className="space-y-6 mb-12">
                {activeSubItem && renderSettingItem(activeSubItem)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
