import React, { useEffect } from "react";
import { useGradientState } from "../../hooks/useGradientState";
import { useNetwork } from "../../hooks/useNetwork";
import NocturneIcon from "../common/icons/NocturneIcon";
import { useConnector } from "../../contexts/ConnectorContext";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  WifiMaxIcon,
  BluetoothIcon,
} from "../common/icons";
import WiFiNetworks from "../settings/network/WiFiNetworks";
import BluetoothDevices from "../settings/network/BluetoothDevices";
import GradientBackground from "../common/GradientBackground";

const NetworkScreen = ({ isConnectionLost = true, onConnectionRestored }) => {
  const [showMain, setShowMain] = React.useState(true);
  const [showParent, setShowParent] = React.useState(false);
  const [showSubpage, setShowSubpage] = React.useState(false);
  const [isAnimating, setIsAnimating] = React.useState(false);
  const [activeSubItem, setActiveSubItem] = React.useState(null);
  const { isConnected: isInternetConnected, hasEverConnectedThisSession } =
    useNetwork();
  const { isRestoringWifiNetworks, isConnectorAvailable } = useConnector();
  const showWifiConnectMessage =
    isConnectorAvailable && isRestoringWifiNetworks;

  useEffect(() => {
    if (
      isInternetConnected &&
      hasEverConnectedThisSession &&
      onConnectionRestored
    ) {
      onConnectionRestored();
    }
  }, [isInternetConnected, hasEverConnectedThisSession, onConnectionRestored]);

  const [mainClasses, setMainClasses] = React.useState(
    "translate-x-0 opacity-100",
  );
  const [parentClasses, setParentClasses] = React.useState(
    "translate-x-full opacity-0",
  );
  const [subpageClasses, setSubpageClasses] = React.useState(
    "translate-x-full opacity-0",
  );

  const ANIMATION_DURATION = 300;

  const [gradientState, updateGradientColors] = useGradientState();

  useEffect(() => {
    updateGradientColors(null, "auth");
  }, [updateGradientColors]);

  const networkOptions = [
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
  ];

  const openNetworkSettings = () => {
    if (isAnimating) return;
    setIsAnimating(true);

    setMainClasses("-translate-x-full opacity-0");
    setParentClasses("translate-x-0 opacity-100");

    setTimeout(() => {
      if (document.querySelector(".settings-scroll-container")) {
        document.querySelector(".settings-scroll-container").scrollTop = 0;
      }
    }, ANIMATION_DURATION / 3);

    setTimeout(() => {
      setShowMain(false);
      setShowParent(true);
      setIsAnimating(false);
    }, ANIMATION_DURATION);
  };

  const navigateToSubpage = (item) => {
    if (isAnimating) return;
    setIsAnimating(true);

    setActiveSubItem(item);
    setParentClasses("-translate-x-full opacity-0");
    setSubpageClasses("translate-x-0 opacity-100");

    setTimeout(() => {
      if (document.querySelector(".settings-scroll-container")) {
        document.querySelector(".settings-scroll-container").scrollTop = 0;
      }
    }, ANIMATION_DURATION / 3);

    setTimeout(() => {
      setShowParent(false);
      setShowSubpage(true);
      setIsAnimating(false);
    }, ANIMATION_DURATION);
  };

  const navigateBack = () => {
    if (isAnimating) return;
    setIsAnimating(true);

    if (showSubpage) {
      setSubpageClasses("translate-x-full opacity-0");
      setParentClasses("translate-x-0 opacity-100");

      setTimeout(() => {
        if (document.querySelector(".settings-scroll-container")) {
          document.querySelector(".settings-scroll-container").scrollTop = 0;
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
        if (document.querySelector(".settings-scroll-container")) {
          document.querySelector(".settings-scroll-container").scrollTop = 0;
        }
      }, ANIMATION_DURATION / 3);

      setTimeout(() => {
        setShowParent(false);
        setShowMain(true);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    }
  };

  const renderSubpage = () => {
    if (!activeSubItem) return null;
    const SubpageComponent = activeSubItem.subpage.component;
    return <SubpageComponent />;
  };

  return (
    <div className="h-screen w-full flex items-center justify-center overflow-hidden fixed inset-0 rounded-2xl z-50">
      <div className="absolute inset-0 bg-black"></div>
      <GradientBackground gradientState={gradientState} />

      <div className="relative z-10 w-full h-full settings-scroll-container overflow-hidden">
        <div
          className={`absolute top-0 left-0 w-full h-full screen-transition ${mainClasses}`}
          style={{
            visibility: showMain || isAnimating ? "visible" : "hidden",
            transition: `transform ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          }}
        >
          <div className="w-full max-w-6xl px-6 mx-auto h-full flex items-center">
            <div className="grid grid-cols-2 gap-16 items-center w-full">
              <div className="flex flex-col items-start space-y-8 ml-12">
                <NocturneIcon className="h-12 w-auto" />

                <div className="space-y-4">
                  <h2 className="text-5xl text-white tracking-tight font-semibold w-[24rem]">
                    {showWifiConnectMessage
                      ? "Connecting to Wi-Fi"
                      : "Connection Lost"}
                  </h2>
                  {showWifiConnectMessage ? (
                    <p className="text-[28px] text-white/60 tracking-tight w-[32rem]">
                      Connecting to Wi-Fi...
                    </p>
                  ) : (
                    <p className="text-[28px] text-white/60 tracking-tight w-[32rem]">
                      Enable Bluetooth Tethering and connect to "Nocturne" in
                      your phone's settings.
                    </p>
                  )}

                  <button
                    onClick={openNetworkSettings}
                    className="mt-4 bg-white/10 hover:bg-white/20 transition-colors duration-200 rounded-xl px-6 py-3 border border-white/10 focus:outline-none"
                  >
                    <span className="text-[28px] font-[560] text-white tracking-tight">
                      Network Settings
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className={`absolute top-0 left-0 w-full h-full screen-transition ${parentClasses}`}
          style={{
            visibility: showParent || isAnimating ? "visible" : "hidden",
            transition: `transform ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          }}
        >
          <div className="p-12 h-full overflow-y-auto scrollbar-hide">
            <div className="flex items-center mb-4">
              <button
                onClick={navigateBack}
                className="bg-transparent border-none mr-4 focus:outline-none"
                disabled={isAnimating}
              >
                <ChevronLeftIcon className="w-8 h-8 text-white" />
              </button>
              <h2 className="text-[46px] font-[580] text-white tracking-tight">
                Network
              </h2>
            </div>

            <div className="space-y-4 mb-12">
              {networkOptions.map((option) => (
                <button
                  key={option.id}
                  onClick={() => navigateToSubpage(option)}
                  className="flex items-center justify-between w-full p-4 bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/10 focus:outline-none"
                  disabled={isAnimating}
                >
                  <div className="flex items-center">
                    <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center">
                      <option.icon className="w-7 h-7 text-white" />
                    </div>
                    <span className="text-[32px] ml-4 font-[580] text-white tracking-tight">
                      {option.title}
                    </span>
                  </div>
                  <ChevronRightIcon className="w-8 h-8 text-white/60" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div
          className={`absolute top-0 left-0 w-full h-full screen-transition ${subpageClasses}`}
          style={{
            visibility: showSubpage || isAnimating ? "visible" : "hidden",
            transition: `transform ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          }}
        >
          <div className="p-12 h-full overflow-y-auto scrollbar-hide">
            <div className="flex items-center mb-4">
              <button
                onClick={navigateBack}
                className="bg-transparent border-none mr-4 focus:outline-none"
                disabled={isAnimating}
              >
                <ChevronLeftIcon className="w-8 h-8 text-white" />
              </button>
              <h2 className="text-[46px] font-[580] text-white tracking-tight">
                {activeSubItem?.title}
              </h2>
            </div>

            <div className="space-y-6 mb-12">{renderSubpage()}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NetworkScreen;
