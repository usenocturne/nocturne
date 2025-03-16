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

const settingsStructure = {
  general: {
    title: "General",
    icon: SettingsGeneralIcon,
    items: [
      {
        id: "idle-redirect",
        title: "Idle Redirect",
        type: "toggle",
        description:
          "Automatically redirect to the Now Playing screen after one minute of inactivity.",
        storageKey: "autoRedirectEnabled",
        defaultValue: false,
      },
      {
        id: "24-hour-time",
        title: "24-Hour Time",
        type: "toggle",
        description:
          "Display the clock in 24-hour format instead of 12-hour format. The clock is only shown in the status bar when connected to Bluetooth.",
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
        id: "lyrics-menu",
        title: "Lyrics Menu Option",
        type: "toggle",
        description: "Enable or disable the lyrics menu option in the player.",
        storageKey: "lyricsMenuEnabled",
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
        description: "Display the elapsed track time below the progress bar.",
        storageKey: "elapsedTimeEnabled",
        defaultValue: false,
      },
      {
        id: "remaining-time",
        title: "Show Time Remaining",
        type: "toggle",
        description: "Display the remaining track time below the progress bar.",
        storageKey: "remainingTimeEnabled",
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

const getDefaultSettingValue = (categoryKey, storageKey) => {
  const category = settingsStructure[categoryKey];
  if (category && category.items) {
    for (const item of category.items) {
      if (
        item.storageKey === storageKey &&
        item.hasOwnProperty("defaultValue")
      ) {
        return item.defaultValue;
      }
    }
  }

  return undefined;
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
  const [currentPage, setCurrentPage] = useState("main");
  const [activeSubpage, setActiveSubpage] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [versionInfo, setVersionInfo] = useState("Loading versions...");
  const [currentView, setCurrentView] = useState({
    page: "main",
    subpage: null,
    item: null,
  });
  const [activeSubItem, setActiveSubItem] = useState(null);
  const shouldExitToRecents = useRef(false);
  const isProcessingEscape = useRef(false);

  const ANIMATION_DURATION = 400;

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

  const [settings, setSettings] = useState(() => {
    const states = {};
    Object.values(settingsStructure).forEach((section) => {
      if (section.items) {
        section.items.forEach((item) => {
          if (item.type === "toggle") {
            const stored = localStorage.getItem(item.storageKey);
            states[item.storageKey] =
              stored !== null ? stored === "true" : item.defaultValue;
          }
        });
      }
    });
    return states;
  });

  useEffect(() => {
    Object.values(settingsStructure).forEach((section) => {
      if (section.items) {
        section.items.forEach((item) => {
          if (
            item.type === "toggle" &&
            localStorage.getItem(item.storageKey) === null
          ) {
            localStorage.setItem(item.storageKey, item.defaultValue.toString());
          }
        });
      }
    });
  }, []);

  const handleToggle = (key) => {
    const newValue = !settings[key];

    setSettings((prev) => {
      const newSettings = { ...prev };

      const updateLocalStorage = (updates) => {
        Object.entries(updates).forEach(([key, value]) => {
          newSettings[key] = value;
          localStorage.setItem(key, value.toString());
        });
      };

      if (key === "elapsedTimeEnabled" || key === "remainingTimeEnabled") {
        if (newValue) {
          const isElapsed = key === "elapsedTimeEnabled";
          updateLocalStorage({
            elapsedTimeEnabled: isElapsed,
            remainingTimeEnabled: !isElapsed,
          });
        } else {
          updateLocalStorage({ [key]: false });
        }
      } else if (key === "showLyricsGestureEnabled") {
        if (newValue) {
          updateLocalStorage({
            showLyricsGestureEnabled: true,
            lyricsMenuEnabled: true,
          });
        } else {
          updateLocalStorage({ [key]: false });
        }
      } else if (key === "lyricsMenuEnabled") {
        if (!newValue) {
          updateLocalStorage({
            showLyricsGestureEnabled: false,
            lyricsMenuEnabled: false,
          });
        } else {
          updateLocalStorage({ [key]: true });
        }
      } else {
        updateLocalStorage({ [key]: newValue });

        if (key === "use24HourTime") {
          window.dispatchEvent(new Event("timeFormatChanged"));
        }
      }

      return newSettings;
    });
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
    if (!isAnimating) {
      setIsAnimating(true);
      shouldExitToRecents.current = false;
      setCurrentPage("transitioning-forward");
      setTimeout(() => {
        setCurrentView({
          page,
          subpage: subItem?.id || null,
          item: subItem || null,
        });
        setActiveSubpage(page);
        setActiveSubItem(subItem);
      }, 50);

      setTimeout(() => {
        const scrollContainer = document.querySelector(
          ".settings-scroll-container"
        );
        if (scrollContainer) {
          scrollContainer.scrollTop = 0;
        }

        setCurrentPage(subItem ? "subpage" : page);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    }
  };

  const navigateBack = () => {
    if (isAnimating) return;

    setIsAnimating(true);
    setCurrentPage("transitioning-back");

    const isInSubpage = currentView.subpage !== null;

    setTimeout(() => {
      if (isInSubpage) {
        setCurrentView({
          page: currentView.page,
          subpage: null,
          item: null,
        });
        setActiveSubItem(null);
        setCurrentPage(currentView.page);
      } else {
        setCurrentView({
          page: "main",
          subpage: null,
          item: null,
        });
        setActiveSubpage(null);
        setActiveSubItem(null);
        setCurrentPage("main");
      }
    }, ANIMATION_DURATION / 2);

    setTimeout(() => {
      setIsAnimating(false);
    }, ANIMATION_DURATION);
  };

  const getPageClasses = (type) => {
    const baseClasses =
      "w-full transition-all duration-[400ms] ease-in-out absolute top-0 left-0";

    switch (type) {
      case "main":
        if (currentPage === "main") {
          return `${baseClasses} translate-x-0 opacity-100 pointer-events-auto`;
        }
        if (currentPage === "transitioning-forward") {
          return `${baseClasses} -translate-x-full opacity-0 pointer-events-none`;
        }
        if (currentPage === "transitioning-back") {
          return `${baseClasses} -translate-x-full opacity-0 pointer-events-none`;
        }
        return `${baseClasses} -translate-x-full opacity-0 pointer-events-none`;

      case "parent":
        if (currentPage === currentView.page && !currentView.subpage) {
          return `${baseClasses} translate-x-0 opacity-100 pointer-events-auto`;
        }
        if (currentPage === "transitioning-forward" && !currentView.subpage) {
          return `${baseClasses} translate-x-full opacity-0 pointer-events-none`;
        }
        if (currentView.subpage) {
          return `${baseClasses} -translate-x-full opacity-0 pointer-events-none`;
        }
        if (currentPage === "transitioning-back") {
          return `${baseClasses} translate-x-full opacity-0 pointer-events-none`;
        }
        return `${baseClasses} translate-x-full opacity-0 pointer-events-none`;

      case "subpage":
        if (currentView.subpage && currentPage === "subpage") {
          return `${baseClasses} translate-x-0 opacity-100 pointer-events-auto`;
        }
        if (currentPage === "transitioning-forward") {
          return `${baseClasses} translate-x-full opacity-0 pointer-events-none`;
        }
        if (currentPage === "transitioning-back") {
          return `${baseClasses} translate-x-full opacity-0 pointer-events-none`;
        }
        return `${baseClasses} translate-x-full opacity-0 pointer-events-none`;

      default:
        return baseClasses;
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
                className={`relative inline-flex h-11 w-20 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  settings[item.storageKey] ? "bg-white/40" : "bg-white/10"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-10 w-10 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    settings[item.storageKey]
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
    const handleKeyDown = (event) => {
      if (
        event.key === "Escape" &&
        !isAnimating &&
        !isProcessingEscape.current
      ) {
        isProcessingEscape.current = true;

        if (currentView.subpage) {
          navigateBack();
        } else if (currentPage !== "main") {
          navigateBack();
        }

        setTimeout(() => {
          isProcessingEscape.current = false;
        }, 100);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAnimating, currentView.subpage, currentPage]);

  return (
    <div className="h-full overflow-y-auto settings-scroll-container">
      <div className="min-h-full flex flex-col px-12 pt-12 -ml-12">
        <div className="flex-1 relative">
          <div className="relative w-full" style={{ minHeight: "100%" }}>
            <div className={getPageClasses("main")}>
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

            {activeSubpage && (
              <>
                <div className={getPageClasses("parent")}>
                  <div className="flex items-center mb-4">
                    <button
                      onClick={navigateBack}
                      className="mr-4"
                      disabled={isAnimating}
                    >
                      <ChevronLeftIcon className="w-8 h-8 text-white" />
                    </button>
                    <h2 className="text-[46px] font-[580] text-white tracking-tight">
                      {settingsStructure[activeSubpage].title}
                    </h2>
                  </div>
                  <div className="space-y-6 mb-12">
                    {settingsStructure[activeSubpage].type === "parent" ? (
                      <div className="space-y-4">
                        {settingsStructure[activeSubpage].items?.map(
                          (subItem) => (
                            <button
                              key={subItem.id}
                              onClick={() => navigateTo(activeSubpage, subItem)}
                              className="flex items-center justify-between w-full p-4 bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/10"
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
                          )
                        )}
                      </div>
                    ) : (
                      settingsStructure[activeSubpage].items?.map((item) =>
                        renderSettingItem(item)
                      )
                    )}
                  </div>
                </div>

                <div className={getPageClasses("subpage")}>
                  <div className="flex items-center mb-4">
                    <button
                      onClick={navigateBack}
                      className="mr-4"
                      disabled={isAnimating}
                    >
                      <ChevronLeftIcon className="w-8 h-8 text-white" />
                    </button>
                    <h2 className="text-[46px] font-[580] text-white tracking-tight">
                      {activeSubItem?.title}
                    </h2>
                  </div>
                  <div className="space-y-6 mb-12">
                    {currentView.subpage && renderSettingItem(currentView.item)}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { getDefaultSettingValue };
