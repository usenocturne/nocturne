import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { Switch } from "@headlessui/react";
import { supabase } from "../../lib/supabaseClient";
import packageInfo from "../../../package.json";
import BluetoothDevices from "../bluetooth/BluetoothDevices";
import {
  BluetoothIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SettingsAccountIcon,
  SettingsAboutIcon,
  SettingsCreditsIcon,
  SettingsGeneralIcon,
  SettingsPlaybackIcon,
  SettingsSupportIcon,
} from "../icons";

const fetchSpotifyProfile = async (accessToken) => {
  try {
    const response = await fetch("https://api.spotify.com/v1/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return await response.json();
  } catch (error) {
    console.error("Error fetching Spotify profile:", error);
    return null;
  }
};

export default function Settings({ accessToken, onOpenDonationModal }) {
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState("main");
  const [activeSubpage, setActiveSubpage] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [versionInfo, setVersionInfo] = useState("Loading versions...");

  const ANIMATION_DURATION = 400;

  const getVersionInfo = async () => {
    const clientVersion = packageInfo.version;
    let osVersion = "Unknown";

    try {
      const response = await fetch("http://localhost:5000/info");
      const data = await response.json();
      osVersion = data.version;
    } catch (error) {
      console.error("Error fetching OS version:", error);
    }

    return `Client version: ${clientVersion}\nOS version: ${osVersion}`;
  };

  useEffect(() => {
    getVersionInfo().then((info) => {
      setVersionInfo(info);
    });
    if (accessToken) {
      fetchSpotifyProfile(accessToken).then((profile) => {
        setUserProfile(profile);
      });
    }
  }, [accessToken]);

  const AccountInfo = () => {
    if (!userProfile) return null;

    return (
      <div className="mb-8">
        <div className="flex items-center mb-6">
          {userProfile.images?.[0]?.url && (
            <img
              src={userProfile.images[0].url}
              alt="Profile"
              className="w-24 h-24 rounded-full mr-4"
            />
          )}
          <div>
            <h3 className="text-[32px] font-[580] text-white tracking-tight">
              {userProfile.display_name}
            </h3>
            <p className="text-[24px] font-[560] text-white/60 tracking-tight">
              {userProfile.email}
            </p>
          </div>
        </div>
      </div>
    );
  };

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
    bluetooth: {
      title: "Bluetooth",
      icon: BluetoothIcon,
      type: "custom",
      items: [
        {
          id: "bluetooth-devices",
          type: "custom",
          component: BluetoothDevices,
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
          description:
            "Enable or disable the lyrics menu option in the player.",
          storageKey: "lyricsMenuEnabled",
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
          description:
            "Display the remaining track time below the progress bar.",
          storageKey: "remainingTimeEnabled",
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
          id: "show-lyrics-gesture",
          title: "Swipe to Show Lyrics",
          type: "toggle",
          description:
            "Enable swiping up on the track info to show the lyrics of a song.",
          storageKey: "showLyricsGestureEnabled",
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
          component: AccountInfo,
        },
        {
          id: "sign-out",
          title: "Sign Out",
          type: "action",
          description: "Sign out and reset authentication settings.",
          action: "signOut",
        },
      ],
    },
    about: {
      title: "About",
      icon: SettingsAboutIcon,
      items: [
        {
          id: "nocturne-version",
          title: "Nocturne Version",
          type: "info",
          description: versionInfo,
        },
        {
          id: "artwork-credits",
          title: "Artwork & Credits",
          type: "info",
          description:
            "All album artwork, artist images, and track metadata are provided by Spotify Technology S.A. These materials are protected by intellectual property rights owned by Spotify or its licensors.",
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

      if (key === "elapsedTimeEnabled" || key === "remainingTimeEnabled") {
        if (newValue) {
          if (key === "elapsedTimeEnabled") {
            newSettings.elapsedTimeEnabled = true;
            newSettings.remainingTimeEnabled = false;
            localStorage.setItem("elapsedTimeEnabled", "true");
            localStorage.setItem("remainingTimeEnabled", "false");
          } else {
            newSettings.remainingTimeEnabled = true;
            newSettings.elapsedTimeEnabled = false;
            localStorage.setItem("remainingTimeEnabled", "true");
            localStorage.setItem("elapsedTimeEnabled", "false");
          }
        } else {
          newSettings[key] = false;
          localStorage.setItem(key, "false");
        }
      } else {
        newSettings[key] = newValue;
        localStorage.setItem(key, newValue.toString());

        if (key === "use24HourTime") {
          window.dispatchEvent(new Event("timeFormatChanged"));
        }
      }

      return newSettings;
    });
  };

  const handleSignOut = async () => {
    try {
      const refreshToken = localStorage.getItem("spotifyRefreshToken");
      const tempId = localStorage.getItem("spotifyTempId");
      const authType = localStorage.getItem("spotifyAuthType");

      if (authType === "custom" && refreshToken && tempId) {
        await supabase.from("spotify_credentials").delete().match({
          temp_id: tempId,
          refresh_token: refreshToken,
        });
      }

      localStorage.removeItem("spotifyAccessToken");
      localStorage.removeItem("spotifyRefreshToken");
      localStorage.removeItem("spotifyTokenExpiry");
      localStorage.removeItem("spotifyAuthType");
      localStorage.removeItem("spotifyTempId");

      router.push("/").then(() => window.location.reload());
    } catch (error) {
      console.error("Error during sign out:", error);
      localStorage.clear();
      router.push("/").then(() => window.location.reload());
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

  const navigateTo = (page) => {
    if (!isAnimating) {
      setIsAnimating(true);

      requestAnimationFrame(() => {
        setCurrentPage("transitioning");

        setTimeout(() => {
          const scrollContainer = document.querySelector(
            ".settings-scroll-container"
          );
          if (scrollContainer) {
            scrollContainer.scrollTop = 0;
          }

          setActiveSubpage(page);
          requestAnimationFrame(() => {
            setCurrentPage(page);
          });
        }, ANIMATION_DURATION / 2);
      });

      setTimeout(() => {
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    }
  };

  const navigateBack = () => {
    if (!isAnimating) {
      setIsAnimating(true);
      setCurrentPage("main");
      setTimeout(() => {
        setActiveSubpage(null);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    }
  };

  const mainMenuClasses = `w-full transition-all duration-[400ms] ease-in-out absolute top-0 left-0 ${
    currentPage === "main"
      ? "translate-x-0 opacity-100 pointer-events-auto"
      : "-translate-x-full opacity-0 pointer-events-none"
  }`;

  const subPageClasses = `w-full transition-all duration-[400ms] ease-in-out absolute top-0 left-0 ${
    currentPage !== "main" && currentPage !== "transitioning"
      ? "translate-x-0 opacity-100 pointer-events-auto"
      : "translate-x-full opacity-0 pointer-events-none"
  }`;

  const renderSettingItem = (item) => {
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
              className="bg-white/10 hover:bg-white/20 w-80 transition-colors duration-200 rounded-[12px] px-6 py-3"
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
              {item.description}
            </p>
          </div>
        );
      case "custom":
        if (item.component) {
          const Component = item.component;
          return <Component key={item.id} />;
        }
        return null;
      default:
        return null;
    }
  };

  return (
    <div className="h-full overflow-y-auto settings-scroll-container">
      <div className="min-h-full flex flex-col px-12 pt-12 -ml-12">
        <div className="flex-1 relative">
          <div className="relative w-full" style={{ minHeight: "100%" }}>
            <div className={mainMenuClasses}>
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
                    className="flex items-center justify-between w-full p-4 bg-white/10 rounded-xl hover:bg-white/20 transition-colors"
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
              <div className={subPageClasses}>
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
                  {settingsStructure[activeSubpage].items?.map((item) =>
                    renderSettingItem(item)
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
