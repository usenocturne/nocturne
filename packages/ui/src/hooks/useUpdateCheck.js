import { useState, useEffect, useCallback, useRef } from "react";
import { sendNocturneWsRequest, subscribeEaSessionState } from "./useNocturned";
import { subscribeInitialDataLoadState } from "./useSpotifyData";

const compareVersions = (v1, v2) => {
  const parseVersion = (version) => {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)(\d*))?$/);
    if (!match) {
      return {
        major: 0,
        minor: 0,
        patch: 0,
        preRelease: null,
        preReleaseNum: null,
      };
    }
    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      preRelease: match[4] || null,
      preReleaseNum: match[5] ? parseInt(match[5], 10) : null,
    };
  };

  const a = parseVersion(v1);
  const b = parseVersion(v2);

  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;

  if (!a.preRelease && !b.preRelease) return 0;
  if (!a.preRelease && b.preRelease) return 1;
  if (a.preRelease && !b.preRelease) return -1;

  if (a.preRelease !== b.preRelease) {
    return a.preRelease > b.preRelease ? 1 : -1;
  }

  if (a.preReleaseNum === null && b.preReleaseNum === null) return 0;
  if (a.preReleaseNum === null) return -1;
  if (b.preReleaseNum === null) return 1;
  if (a.preReleaseNum !== b.preReleaseNum)
    return a.preReleaseNum > b.preReleaseNum ? 1 : -1;

  return 0;
};

const isCompatible = (currentVersion, minimumVersion) => {
  const parseVersion = (version) => {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)(\d*))?$/);
    if (!match) {
      return {
        major: 0,
        minor: 0,
        patch: 0,
        preRelease: null,
        preReleaseNum: null,
      };
    }
    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      preRelease: match[4] || null,
      preReleaseNum: match[5] ? parseInt(match[5], 10) : null,
    };
  };

  const current = parseVersion(currentVersion);
  const minimum = parseVersion(minimumVersion);

  if (current.major !== minimum.major) return current.major > minimum.major;
  if (current.minor !== minimum.minor) return current.minor > minimum.minor;
  if (current.patch !== minimum.patch) return current.patch > minimum.patch;

  return true;
};

export const useUpdateCheck = (currentVersion, autoCheck = true) => {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const [updateChain, setUpdateChain] = useState([]);
  const [eaSessionStarted, setEaSessionStarted] = useState(false);
  const [initialDataLoadComplete, setInitialDataLoadComplete] = useState(false);
  const checkInProgress = useRef(false);
  const currentVersionRef = useRef(currentVersion);

  useEffect(() => {
    currentVersionRef.current = currentVersion;
  }, [currentVersion]);

  useEffect(() => {
    const unsubscribe = subscribeEaSessionState((isStarted) => {
      setEaSessionStarted(isStarted);
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeInitialDataLoadState((isComplete) => {
      setInitialDataLoadComplete(isComplete);
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  const checkForUpdates = useCallback(
    async (force = false) => {
      if (isChecking || checkInProgress.current) return;

      if (!eaSessionStarted) {
        console.log("Skipping update check: EA session not started yet");
        return;
      }

      if (!force && !initialDataLoadComplete) {
        console.log(
          "Skipping update check: Initial data load not complete yet",
        );
        return;
      }

      if (!currentVersionRef.current) {
        console.log("Skipping update check: Current version not loaded yet");
        return;
      }

      checkInProgress.current = true;
      setIsChecking(true);
      setError(null);

      try {
        const versionToCheck = currentVersionRef.current.startsWith("v")
          ? currentVersionRef.current
          : `v${currentVersionRef.current}`;

        const otaCheckResult = await sendNocturneWsRequest("device.ota.check", {
          currentVersion: versionToCheck,
        });

        if (!otaCheckResult.updateAvailable) {
          setUpdateInfo({
            hasUpdate: false,
            canUpdate: false,
            nextInChain: false,
            totalUpdates: 0,
            version: currentVersionRef.current,
          });
          setLastChecked(new Date());
          return;
        }

        const updateVersion = otaCheckResult.version.replace(/^v/, "");
        const canUpdate = otaCheckResult.metadata?.auto_updateable !== false;

        const releaseData = {
          version: updateVersion,
          tag: otaCheckResult.version,
          shortDescription: "This update brings new features and bug fixes.",
          fullDescription: "This update brings new features and bug fixes.",
          releaseNotes: "This update brings new features and bug fixes.",
          releaseDate: new Date().toISOString(),
          releaseSize: 0,
          imageUrl: "/images/os/nocturne/3.0.0.webp",
          assetUrls: {},
          assetSums: {},
        };

        setUpdateInfo({
          ...releaseData,
          hasUpdate: true,
          canUpdate: canUpdate,
          nextInChain: false,
          totalUpdates: 1,
          channel: otaCheckResult.channel,
          critical: otaCheckResult.metadata?.critical || false,
        });

        setUpdateChain([releaseData]);
        setLastChecked(new Date());
      } catch (err) {
        console.error("Error checking for updates:", err);
        setError(err.message);
      } finally {
        setIsChecking(false);
        checkInProgress.current = false;
      }
    },
    [eaSessionStarted, initialDataLoadComplete],
  );

  const findUpdateChain = (currentVersion, releases) => {
    if (!releases || releases.length === 0) return [];

    const releaseMap = new Map();
    for (const release of releases) {
      releaseMap.set(release.version, release);
    }

    const sortedReleases = [...releases].sort((a, b) =>
      compareVersions(a.version, b.version),
    );

    const possibleNextUpdates = sortedReleases.filter(
      (release) =>
        compareVersions(release.version, currentVersion) > 0 &&
        isCompatible(currentVersion, release.minimumVersion),
    );

    if (possibleNextUpdates.length === 0) {
      return [];
    }

    const allPaths = [];

    for (const nextUpdate of possibleNextUpdates) {
      const path = [nextUpdate];
      let currentStep = nextUpdate;

      while (true) {
        const possibleNextSteps = sortedReleases.filter(
          (release) =>
            compareVersions(release.version, currentStep.version) > 0 &&
            isCompatible(currentStep.version, release.minimumVersion),
        );

        if (possibleNextSteps.length === 0) {
          break;
        }

        const nextStep = possibleNextSteps[0];
        path.push(nextStep);
        currentStep = nextStep;
      }

      allPaths.push(path);
    }

    if (allPaths.length === 0) {
      return [];
    }

    let bestPath = allPaths[0];
    for (const path of allPaths.slice(1)) {
      const bestPathLastVersion = bestPath[bestPath.length - 1].version;
      const currentPathLastVersion = path[path.length - 1].version;

      if (compareVersions(currentPathLastVersion, bestPathLastVersion) > 0) {
        bestPath = path;
      } else if (
        compareVersions(currentPathLastVersion, bestPathLastVersion) === 0 &&
        path.length < bestPath.length
      ) {
        bestPath = path;
      }
    }

    return bestPath;
  };

  useEffect(() => {
    if (
      autoCheck &&
      eaSessionStarted &&
      initialDataLoadComplete &&
      currentVersion
    ) {
      checkForUpdates();
    }
  }, [
    autoCheck,
    eaSessionStarted,
    initialDataLoadComplete,
    currentVersion,
    checkForUpdates,
  ]);

  const advanceUpdateChain = useCallback(() => {
    if (updateChain.length <= 1) {
      setUpdateChain([]);
      setUpdateInfo((prev) => ({
        ...prev,
        hasUpdate: false,
        canUpdate: false,
        nextInChain: false,
        totalUpdates: 0,
      }));
      return;
    }

    const newChain = updateChain.slice(1);
    setUpdateChain(newChain);

    const nextUpdate = newChain[0];
    setUpdateInfo({
      ...nextUpdate,
      hasUpdate: true,
      canUpdate: true,
      nextInChain: newChain.length > 1,
      totalUpdates: newChain.length,
    });
  }, [updateChain]);

  return {
    updateInfo,
    isChecking,
    error,
    lastChecked,
    checkForUpdates,
    advanceUpdateChain,
    updateChain,
  };
};
