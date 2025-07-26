import React, { useState, useEffect, useRef } from "react";
import { Switch } from "@headlessui/react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
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
          "Enable or disable the scrolling animation for long names in the UI.",
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
        description: "Sign out of your Spotify account.",
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
        names: [
          "angelolz",
          "EllEation",
          "Jenner Gray",
          "vakst",
          "álvaro s",
          "Justin Reynard",
        ],
      },
      {
        id: "sponsors",
        title: "Sponsors",
        type: "sponsors",
        names: [
          "Daniel Smith",
          "Logan",
          "paulcity",
          "Vladdy",
          "Nathan",
          "SeveralZombies",
          "DeepfakeKittens",
          "Jenner Gray",
          "Jesse A Kantor",
          "Josef Halcomb",
          "MaydaySilly",
          "SeanCMNJ",
          "tasteeohs",
          "BlackFlag",
          "Bomb",
          "Fernando Díaz González",
          "h2k",
          "smugdog",
          "Tanner",
          "Thomas",
          "Vonnieboo from ff.net",
          "13EnbiesInATrenchcoat",
          "@lukwstkn",
          "Begouin",
          "Bestestdev",
          "bompo312",
          "Christopher Cartwright",
          "ClovisBae from reddit",
          "D4137",
          "DanL",
          "Devcrowley",
          "discord: @terbro#9956",
          "Drevmeister-Fresh",
          "Dustin",
          "Ethan Pruitt",
          "Exx-on",
          "Garrett Webb",
          "Gerald Lesnak II",
          "Hyrule Villager",
          "Jaime Sánchez",
          "Jeff Reiner",
          "Madison Hallowell",
          "Morgan",
          "nguyenkvvn",
          "Pablo Portilla",
          "Reuben Lo",
          "Robert Max Womack",
          "Sergio Navarro",
          "SK",
          "Tóthmárton Ákos",
          "timothy chilinski",
          "Tyri J Smith",
          "Vasiliy Uchanev",
          "Xavier Garza",
          "23r01nf1n17y",
          "Alfonso Morales",
          "Archmeyvn",
          "Austyn Tjulander",
          "Awston Roden",
          "@cackhanded",
          "Cameron Williams",
          "Cody Rees",
          "Cowsaysmoo",
          "Creeper_798",
          "CyberDruid",
          "Dave",
          "Garry Hendry",
          "Greg Solis",
          "itsamanpret",
          "Jackson Lopata",
          "James Augustine",
          "Jesse Lopez",
          "jxding",
          "Krypthos",
          "Matthew McPheeters",
          "mattisvensson ",
          "Mids",
          "mobius_j",
          "Murdrous",
          "Navi",
          "rerunx5 (Alex)",
          "scornwell",
          "Slackticus",
          "Tempo",
          "Thaddeus Nagy",
          "uktexan",
          "Yungguap",
          "1Vortex",
          "_0.0.1_",
          "abd_uhh",
          "Abid Rasheed",
          "Adam",
          "Adam",
          "Adam Duda",
          "Adam Kunic",
          "acousticjacob",
          "Akhad Alimov",
          "Akshith Gunasekaran",
          "Alan A",
          "Alexander Black",
          "Alex Haseler",
          "Ali Khodr-Ali",
          "AlxLve",
          "Alzitra",
          "Andrew",
          "Andrew J. Pafitis",
          "Andrew Pratt",
          "Angelolz",
          "AnxietyPlus",
          "Anthony E Mason",
          "Anthony Petrella",
          "Arturo Hernandez",
          "Aug#5404",
          "Austin Heiss",
          "automathematics",
          "Barrett Belanger",
          "barnabas_lsq",
          "BASTIAAN WILLEM DE VRIES",
          "Benjamin Menendez",
          "Brandon Fawcett",
          "Brian Humensky",
          "@bubbleofvelvet",
          "BudGillett",
          "Canaan.0",
          "Canyon",
          "Cameron Hyde",
          "Carter Juckes",
          "Casper Bruning",
          "Cbb",
          "Charlie Vince-Crowhurst",
          "Chatito0s",
          "Checked Me",
          "CheezborgorSanwitch",
          "Christian Klit",
          "Christopher",
          "Christopher Swenson",
          "Cian",
          "CircuitFox",
          "Clark Hager",
          "codex (dartmouthcollege)",
          "Cole Conrad",
          "Colleen Smith",
          "Colin R.",
          "Connor George",
          "Cooper Johnson",
          "Corks & Controllers",
          "cosmicfoureyes",
          "crakerjac",
          "Daniel R",
          "Dan Segal",
          "David Bastos",
          "David Ellis",
          "DC",
          "ddooee",
          "DeanGulBairy",
          "Derek Patterson",
          "dhhh0729",
          "discord: @cereal2",
          "discord: @Forgetful19#8608",
          "discord: @ry_az",
          "Dom",
          "Dominic Tesch",
          "Doosed",
          "Dylan",
          "@efrondeur",
          "Elijah Segers",
          "Eliel Viseman",
          "ElGibbay",
          "ellie!",
          "entropyofdesire",
          "Erbay",
          "Eric Karnes",
          "eschar_heron on discord",
          "Ethan Proia",
          "Evan Garaizar",
          "Fifthman",
          "Franking4",
          "Freesnöw",
          "GenerlAce",
          "Gerardo Ulloa",
          "@gjcodes",
          "gooby",
          "Grayson WendtGeisler",
          "gumbum3",
          "Hannah Walters",
          "HarpMudd",
          "harry",
          "I E J HERON",
          "insane ",
          "ISAAC J NORTON",
          "JaCrispy",
          "Jackson Davis",
          "Jack Murphy",
          "Jack Schaeffer",
          "Jacob Winn",
          "jagger cardenas",
          "Jaime Gabriel",
          "Jake Laster",
          "Jake S",
          "Jason Lee",
          "Jasperjaks",
          "Jayden",
          "Jeremie Boudreau",
          "Jeremy Tavener",
          "Jesus Pena",
          "jiddahidda",
          "JOEL PASCAL MEYER",
          "Joe",
          "Joe Gerard",
          "John Byrd",
          "John Karoul",
          "John M Nerney",
          "Jonah Philippon",
          "Jonathan Irwin",
          "Jonathan Xayabanha",
          "Joseph P Aguirre",
          "Joshua Dixon",
          "Joshua Villalta",
          "@jrosser04",
          "Julian Bill",
          "Julian Gonzales",
          "Julian Tokarev",
          "justin473011",
          "Justin Rogers",
          "K. Colin Pinegar",
          "Kaden",
          "karltonmarx",
          "Kelsie",
          "Kevin Lara",
          "Kiguy2052",
          "Korey Sawdey",
          "Kropka",
          "Kyle Knowles",
          "Liam Winters",
          "@lillyyagirl",
          "Linus Fraley",
          "@lordofstick_",
          "Louie2Lit",
          "Louis Pietruszewski",
          "Lucas Templin",
          "Luis Dominguez",
          "Luis Garcia",
          "MANDEEP SINGH AL GURDIP SINGH",
          "marcel",
          "Mark Councell",
          "Matt McKillen",
          "Matthew r Urso",
          "Maxb0tbeep",
          "MC",
          "Michael Dayah",
          "Michael Seltzer",
          "Michelle Joudrey",
          "Midnight Wolf",
          "Miguel Martinez",
          "Miguel Martinez",
          "Moaath",
          "mord1991",
          "MrPickles01",
          "N8",
          "Naga",
          "Narp",
          "@nelson8403",
          "Nicholas Gelone",
          "Nicholas Warner",
          "Nickolas Schuessler",
          "nightsleep",
          "Nohryzon",
          "nono9k",
          "Ole Noetzel",
          "ON4BCY",
          "owen",
          "parrot#2507",
          "Patrick Bowden",
          "patrickjmcd",
          "Paul Herron",
          "PeterPig",
          "Phillip Deguzman",
          "@pineappleundies",
          "Pink",
          "Piotr Laczynski",
          "pocketfish",
          "Random Weeb",
          "Renato Oliveira",
          "Rob",
          "roddiemod",
          "Rodrigo Manzano-Baltazar",
          "runaway254",
          "Sam Jakub",
          "Sara Beattie",
          "@SgtAngel777",
          "Sean Blair",
          "Sean Decker",
          "Sean Kearney",
          "seoulcialite",
          "sergiok9505",
          "SezyKnight",
          "Sheel Patel",
          "silv3rsid3up",
          "Skatelivelearn",
          "sneese",
          "Softbroed",
          "SolitaryHyena",
          "Stanley Manalansan",
          "Steven Snoke",
          "sunlime",
          "Taylor",
          "tb",
          "TechGeek01",
          "therage1367 (discord)",
          "@theflopytaco",
          "Thomas",
          "Timothy Membrino",
          "titto.",
          "tokkipan",
          "Tong Kai Ming",
          "Travis Stoia",
          "@tricxtr",
          "Ubaldo Rodriguez",
          "Ulises",
          "VeggiEgg",
          "VectorGlitch",
          "Vivyy",
          "Vladimir Akst",
          "Vladimir Stepakhin",
          "walnka",
          "wally",
          "Wazzup",
          "whathebuddha",
          "whizkid98",
          "Wicr",
          "Will Baxter",
          "William Bjorvik",
          "xb",
          "xxgreeninkxx",
          "yayamori",
          "Zackary Mong",
          "Zak",
          "Zimworf",
          "ZonkDE",
          "鐘宏亮",
        ],
      },
    ],
  },
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

  const handleFactoryReset = async () => {
    try {
      fetch("http://localhost:5000/device/factoryreset", { method: "POST" });
      setShowFactoryResetDialog(false);
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
                className={`relative inline-flex h-11 w-20 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
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
                {activeSubItem && renderSettingItem(activeSubItem)}
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
