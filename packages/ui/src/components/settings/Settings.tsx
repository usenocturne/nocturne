import React, { useState, useEffect, useRef } from "react";
import { Switch } from "@headlessui/react";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SettingsUpdateIcon,
  SettingsCreditsIcon,
  SettingsGeneralIcon,
  SettingsPlaybackIcon,
  SettingsSupportIcon,
  SettingsAboutIcon,
  BluetoothIcon,
} from "../common/icons";
import SoftwareUpdate from "./SoftwareUpdate";
import BluetoothDevices from "./network/BluetoothDevices";
import About from "./About";
import { useSettings } from "../../contexts/SettingsContext";
import {
  isConnectorPlatform,
  sendNocturneWsRequest,
} from "../../hooks/useNocturned";
import { useSubscription } from "../../hooks/useSubscription";

const settingsStructure = {
  support: {
    title: "Support Nocturne",
    icon: SettingsSupportIcon,
  },
  general: {
    title: "General",
    icon: SettingsGeneralIcon,
    items: [
      {
        id: "microphone",
        title: "Microphone",
        type: "toggle",
        description:
          "Enable the microphone for wake word detection and voice commands.",
        storageKey: "micMuted",
        defaultValue: false,
        invert: true,
      },
      {
        id: "classic-ui",
        title: "Mockingbird UI",
        type: "toggle",
        description: "Switch to the classic Spotify Car Thing interface.",
        storageKey: "mockingbirdUiEnabled",
        defaultValue: false,
      },
      {
        id: "start-with-now-playing",
        title: "Start with Now Playing",
        type: "toggle",
        description: "When enabled, the app will open directly to Now Playing.",
        storageKey: "startWithNowPlaying",
        defaultValue: false,
      },
      {
        id: "idle-lock",
        title: "Auto-lock when idle",
        type: "toggle",
        description: "Show the lock screen after 5 minutes of inactivity.",
        storageKey: "idleLockEnabled",
        defaultValue: false,
      },
      {
        id: "idle-display-sleep",
        title: "Backlight off when idle",
        type: "toggle",
        description:
          "Turn the backlight off after 20 minutes of inactivity. Tap or press a button to wake.",
        storageKey: "idleDisplaySleepEnabled",
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
      {
        id: "phone-calls",
        title: "Phone Calls",
        type: "toggle",
        description:
          "Show incoming phone calls onscreen with answer and decline controls.",
        storageKey: "nativePhoneCallsEnabled",
        defaultValue: true,
        requiresDirectPhone: true,
      },
      {
        id: "phone-notifications",
        title: "Phone Notifications",
        type: "toggle",
        description: "Show mirrored notifications from your phone onscreen.",
        storageKey: "nativeNotificationsEnabled",
        defaultValue: true,
        requiresDirectPhone: true,
      },
      {
        id: "factory-reset",
        title: "Factory Reset",
        type: "action",
        description:
          "Erase all stored settings and paired Bluetooth devices. This cannot be undone.",
        action: "factoryReset",
      },
    ],
  },
  update: {
    title: "Software Update",
    icon: SettingsUpdateIcon,
    items: [
      {
        id: "update-settings",
        title: "Update Settings",
        type: "navigate",
        icon: SettingsGeneralIcon,
        items: [
          {
            id: "auto-update",
            title: "Automatic Updates",
            type: "toggle",
            description:
              "Automatically download and install updates when available.",
            storageKey: "autoUpdateEnabled",
            defaultValue: true,
          },
          {
            id: "beta-updates",
            title: "Beta Releases",
            type: "toggle",
            description:
              "Receive beta updates before they are released to everyone. Beta builds may be unstable. You will not be able to return to the previous stable version.",
            storageKey: "betaUpdatesEnabled",
            defaultValue: false,
          },
        ],
      },
      {
        id: "software-update",
        type: "custom",
        component: SoftwareUpdate,
      },
    ],
  },
  bluetooth: {
    title: "Bluetooth",
    icon: BluetoothIcon,
    type: "custom",
    component: BluetoothDevices,
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
          "Scroll long song titles in Now Playing. Turn off to wrap titles across multiple lines.",
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
        description: "Display the elapsed track time below the progress bar.",
        storageKey: "elapsedTimeEnabled",
        defaultValue: false,
      },
      {
        id: "knob-seeks-playback",
        title: "Knob Seeks Playback",
        type: "toggle",
        description:
          "Use the knob to seek through playback instead of controlling volume.",
        storageKey: "knobSeeksPlaybackEnabled",
        defaultValue: false,
      },
    ],
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
        names: ["Brandon Saldan", "bbaovanc", "Dominic Frye", "Neel Patel"],
      },
      {
        id: "contributors",
        title: "Contributors",
        type: "sponsors",
        names: [
          "álvaro s",
          "angelolz",
          "Anton Smith",
          "busybox11",
          "Daniel Kubatko",
          "EllEation",
          "Jenner Gray",
          "Justin Reynard",
          "Mike Almeloo",
          "vakst",
        ],
      },
      {
        id: "sponsors",
        title: "Supporters",
        type: "sponsors",
        message:
          "A heartfelt thank you to the hundreds of supporters who believed in us from the start. We couldn't do this without you.",
      },
    ],
  },
  about: {
    title: "About",
    icon: SettingsAboutIcon,
    type: "custom",
    component: About,
  },
};

export default function Settings({
  onOpenDonationModal,
  setActiveSection,
}: UiComponentProps) {
  const [versionInfo, setVersionInfo] = useState("Loading versions...");
  const [activeParent, setActiveParent] = useState(null);
  const [activeSubItem, setActiveSubItem] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const shouldExitToRecents = useRef(false);
  const scrollContainerRef = useRef(null);
  const {
    settings,
    updateSetting,
    isMicLocked,
    appPlatform,
    isNativePhonePresentationLocked,
    nativePhonePresentationLockMessage,
  } = useSettings();
  const { isSubscribed, hasPhoneAccess } = useSubscription();
  const [showFactoryResetDialog, setShowFactoryResetDialog] = useState(false);

  const [showMain, setShowMain] = useState(true);
  const [showParent, setShowParent] = useState(false);
  const [showSubpage, setShowSubpage] = useState(false);

  const [mainClasses, setMainClasses] = useState("translate-x-0 opacity-100");
  const [parentClasses, setParentClasses] = useState(
    "translate-x-full opacity-0",
  );
  const [subpageClasses, setSubpageClasses] = useState(
    "translate-x-full opacity-0",
  );

  const ANIMATION_DURATION = 300;

  useEffect(() => {
    scrollContainerRef.current = document.querySelector(
      ".settings-scroll-container",
    );
  }, []);

  useEffect(() => {
    setTimeout(() => {
      setVersionInfo("Client version: 3.0.0\nOS version: 1.0.0");
    }, 1000);
  }, []);

  const handleToggle = (key) => {
    if (
      key === "mockingbirdUiEnabled" &&
      appPlatform !== "web" &&
      hasPhoneAccess === false
    )
      return;
    if (key === "micMuted" && isMicLocked) return;
    if (
      (key === "nativePhoneCallsEnabled" ||
        key === "nativeNotificationsEnabled") &&
      isNativePhonePresentationLocked
    )
      return;
    updateSetting(key, !settings[key]);
  };

  const handleFactoryReset = async () => {
    try {
      await sendNocturneWsRequest("device.factoryreset", {});
      console.log("Factory reset request sent");
      setShowFactoryResetDialog(false);

      setTimeout(async () => {
        try {
          await sendNocturneWsRequest("device.power.reboot", {});
          console.log("Reboot request sent after factory reset");
        } catch (rebootError) {
          console.error("Reboot request failed:", rebootError);
        }
      }, 1000);
    } catch (error) {
      console.error("Error during factory reset:", error);
      setShowFactoryResetDialog(false);
    }
  };

  const handleSignOut = async () => {
    try {
      localStorage.removeItem("spotifyAccessToken");
      localStorage.removeItem("spotifyRefreshToken");
      localStorage.removeItem("spotifyTokenExpiry");
      localStorage.removeItem("spotifyAuthType");
      window.location.reload();
    } catch (error) {
      console.error("Error during sign out:", error);
      localStorage.clear();
      window.location.reload();
    }
  };

  const handleAction = (action) => {
    switch (action) {
      case "factoryReset":
        setShowFactoryResetDialog(true);
        break;
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

    if (
      showMain &&
      settingsStructure[page]?.type === "custom" &&
      settingsStructure[page]?.component
    ) {
      setMainClasses("-translate-x-full opacity-0");
      setSubpageClasses("translate-x-0 opacity-100");
      setActiveSubItem({
        id: page,
        title: settingsStructure[page].title,
        type: "custom",
        component: settingsStructure[page].component,
      });

      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0;
        }
      }, ANIMATION_DURATION / 3);

      setTimeout(() => {
        setShowMain(false);
        setShowSubpage(true);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    } else if (showMain) {
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
      if (
        activeSubItem &&
        settingsStructure[activeSubItem.id]?.type === "custom"
      ) {
        setSubpageClasses("translate-x-full opacity-0");
        setMainClasses("translate-x-0 opacity-100");

        setTimeout(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
          }
        }, ANIMATION_DURATION / 3);

        setTimeout(() => {
          setShowSubpage(false);
          setShowMain(true);
          setActiveSubItem(null);
          setIsAnimating(false);
        }, ANIMATION_DURATION);
      } else {
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
      }
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
      case "navigate":
        return (
          <button
            key={item.id}
            onClick={() => navigateTo(activeParent, item)}
            className="flex items-center justify-between w-full p-4 bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/10 focus:outline-none mb-4"
            disabled={isAnimating}
          >
            <div className="flex items-center">
              <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center">
                <item.icon className="w-7 h-7 text-white" />
              </div>
              <span className="text-[32px] ml-4 font-[580] text-white tracking-tight">
                {item.title}
              </span>
            </div>
            <ChevronRightIcon className="w-8 h-8 text-white/60" />
          </button>
        );
      case "toggle": {
        const isMockingbirdToggle = item.storageKey === "mockingbirdUiEnabled";
        const isMicToggle = item.storageKey === "micMuted";
        const isNativePhoneToggle = item.requiresDirectPhone === true;

        const isMicConnectorLocked =
          isMicToggle && isConnectorPlatform(appPlatform);
        const isMicSubLocked =
          isMicToggle &&
          !isConnectorPlatform(appPlatform) &&
          isSubscribed === false;
        const isMockingbirdSubLocked =
          isMockingbirdToggle &&
          appPlatform !== "web" &&
          hasPhoneAccess === false;

        const isToggleDisabled =
          isMicConnectorLocked ||
          isMicSubLocked ||
          isMockingbirdSubLocked ||
          (isNativePhoneToggle && isNativePhonePresentationLocked);

        const effectiveRawValue =
          isMicConnectorLocked || isMicSubLocked
            ? true
            : isNativePhoneToggle && isNativePhonePresentationLocked
              ? false
              : settings[item.storageKey];
        const displayedValue = item.invert
          ? !effectiveRawValue
          : effectiveRawValue;
        return (
          <div
            key={item.id}
            className={`mb-8 ${isToggleDisabled ? "opacity-50" : ""}`}
          >
            <div className="flex items-center">
              <Switch
                checked={displayedValue}
                onChange={() =>
                  !isToggleDisabled && handleToggle(item.storageKey)
                }
                disabled={isToggleDisabled}
                className={`relative inline-flex h-11 w-20 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  displayedValue ? "bg-white/40" : "bg-white/10"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-10 w-10 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    displayedValue ? "translate-x-9" : "translate-x-0"
                  }`}
                />
              </Switch>
              <span className="ml-3 text-[32px] font-[580] text-white tracking-tight">
                {item.title}
              </span>
            </div>
            <p className="pt-4 text-[28px] font-[560] text-white/60 max-w-[380px] tracking-tight">
              {isToggleDisabled
                ? isMicConnectorLocked
                  ? "The microphone is only available when using the Nocturne mobile app."
                  : isMicSubLocked
                    ? "Subscribe to Nocturne+ to use voice controls."
                    : isNativePhoneToggle
                      ? nativePhonePresentationLockMessage
                      : "Get Nocturne+ or Nocturne Lifetime to use the classic Spotify Car Thing interface."
                : item.description}
            </p>
          </div>
        );
      }
      case "action":
        return (
          <div key={item.id} className="mb-8">
            <button
              onClick={() => handleAction(item.action)}
              className="bg-white/10 hover:bg-white/20 w-80 transition-colors duration-200 rounded-[12px] px-6 py-3 border border-white/10 focus:outline-none"
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
            {item.message ? (
              <p className="text-[28px] font-[560] text-white/60 max-w-[640px] tracking-tight">
                {item.message}
              </p>
            ) : (
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
            )}
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
    <div
      className="h-full overflow-y-auto overflow-x-hidden settings-scroll-container scroll-smooth transform-gpu will-change-transform"
      style={{
        touchAction: "pan-y",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
        willChange: "transform",
      }}
    >
      <style>{`
        .screen-transition {
          transition: transform ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1),
                      opacity ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1);
          will-change: transform, opacity;
        }
        .settings-scroll-container::-webkit-scrollbar {
          display: none;
        }
        .custom-scrollbar-hide::-webkit-scrollbar { display: none; }
        .custom-scrollbar-hide { scrollbar-width: none; -ms-overflow-style: none; }
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
                    className="flex items-center justify-between w-full p-4 bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/10 focus:outline-none"
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
                  className="mr-4 focus:outline-none"
                  style={{ background: "none" }}
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
                        className="flex items-center justify-between w-full p-4 bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/10 focus:outline-none"
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
                    renderSettingItem(item),
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
                  className="mr-4 focus:outline-none"
                  style={{ background: "none" }}
                  disabled={isAnimating}
                >
                  <ChevronLeftIcon className="w-8 h-8 text-white" />
                </button>
                <h2 className="text-[46px] font-[580] text-white tracking-tight">
                  {activeSubItem?.title}
                </h2>
              </div>
              <div className="space-y-6 mb-12">
                {activeSubItem &&
                activeSubItem.type === "navigate" &&
                activeSubItem.items
                  ? activeSubItem.items.map((item) => renderSettingItem(item))
                  : activeSubItem && renderSettingItem(activeSubItem)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog
        open={showFactoryResetDialog}
        onClose={() => setShowFactoryResetDialog(false)}
        className="relative z-50"
      >
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/60 transition-opacity data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200 data-[enter]:ease-out data-[leave]:ease-in"
        />

        <div className="fixed inset-0 z-50 w-screen overflow-y-auto">
          <div
            className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0"
            style={{ fontFamily: "var(--font-inter)" }}
          >
            <DialogPanel
              transition
              className="relative transform overflow-hidden rounded-[17px] bg-[#161616] px-0 pb-0 pt-5 text-left shadow-xl transition-all data-[closed]:translate-y-4 data-[closed]:opacity-0 data-[enter]:duration-300 data-[leave]:duration-200 data-[enter]:ease-out data-[leave]:ease-in sm:my-8 sm:w-full sm:max-w-[36rem] data-[closed]:sm:translate-y-0 data-[closed]:sm:scale-95"
            >
              <div>
                <div className="text-center">
                  <DialogTitle
                    as="h3"
                    className="text-[36px] font-[560] tracking-tight text-white"
                  >
                    Factory Reset?
                  </DialogTitle>
                  <div className="mt-2">
                    <p className="text-[28px] font-[560] tracking-tight text-white/60">
                      This will erase all stored settings and paired Bluetooth
                      devices. This cannot be undone.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-5 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-0 border-t border-slate-100/25">
                <button
                  type="button"
                  onClick={() => setShowFactoryResetDialog(false)}
                  className="inline-flex w-full justify-center px-3 py-3 text-[28px] font-[560] tracking-tight text-[#6c8bd5] shadow-sm sm:col-start-1 border-r border-slate-100/25 bg-transparent hover:bg-white/5 focus:outline-none"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleFactoryReset}
                  className="mt-3 inline-flex w-full justify-center px-3 py-3 text-[28px] font-[560] tracking-tight text-[#fe3b30] shadow-sm sm:col-start-2 sm:mt-0 bg-transparent hover:bg-white/5 focus:outline-none"
                >
                  Reset
                </button>
              </div>
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
