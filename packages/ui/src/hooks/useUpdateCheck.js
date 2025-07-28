import { useState, useEffect, useCallback, useRef } from "react";

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
  const checkInProgress = useRef(false);
  const currentVersionRef = useRef(currentVersion);

  useEffect(() => {
    currentVersionRef.current = currentVersion;
  }, [currentVersion]);

  const checkForUpdates = useCallback(async () => {
    if (isChecking || checkInProgress.current) return;

    checkInProgress.current = true;
    setIsChecking(true);
    setError(null);

    try {
      const releasesResponse = await fetch(
        `https://api.github.com/repos/usenocturne/updater-test/releases`,
      );

      if (!releasesResponse.ok) {
        throw new Error(`Failed to fetch releases: ${releasesResponse.status}`);
      }

      const releases = await releasesResponse.json();
      const validReleases = [];

      for (const release of releases) {
        const updateJsonAsset = release.assets.find(
          (asset) => asset.name === "update.json",
        );
        if (!updateJsonAsset) continue;

        try {
          const updateJsonResponse = await fetch(
            "http://localhost:5000/fetchjson",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: updateJsonAsset.browser_download_url,
              }),
            },
          );
          if (!updateJsonResponse.ok) continue;

          const updateJson = await updateJsonResponse.json();

          const releaseData = {
            ...updateJson,
            tag: release.tag_name,
            releaseNotes: release.body,
            releaseDate: release.published_at,
            releaseSize: release.assets.find(
              (a) => a.name === updateJson.files.update,
            ).size,
            assetUrls: {},
            assetSums: {},
          };

          for (const [key, fileName] of Object.entries(updateJson.files)) {
            const asset = release.assets.find((a) => a.name === fileName);
            if (asset) {
              releaseData.assetUrls[key] = asset.browser_download_url;
              if (asset.digest) {
                releaseData.assetSums[key] = asset.digest.replace(
                  /^sha256:/,
                  "",
                );
              }
            }
          }

          validReleases.push(releaseData);
        } catch (error) {
          console.warn(`Failed to process release ${release.tag_name}:`, error);
        }
      }

      validReleases.sort((a, b) => compareVersions(b.version, a.version));

      const chain = findUpdateChain(currentVersionRef.current, validReleases);
      setUpdateChain(chain);

      if (chain.length > 0) {
        const nextUpdate = chain[0];
        setUpdateInfo({
          ...nextUpdate,
          hasUpdate: true,
          canUpdate: true,
          nextInChain: chain.length > 1,
          totalUpdates: chain.length,
        });
      } else if (validReleases.length > 0) {
        const latestRelease = validReleases[0];
        const isNewer =
          compareVersions(latestRelease.version, currentVersionRef.current) > 0;

        if (isNewer) {
          setUpdateInfo({
            ...latestRelease,
            hasUpdate: true,
            canUpdate: false,
            nextInChain: false,
            totalUpdates: 1,
            noCompatiblePath: true,
          });
        } else {
          setUpdateInfo({
            ...latestRelease,
            hasUpdate: false,
            canUpdate: false,
            nextInChain: false,
            totalUpdates: 0,
          });
        }
      } else {
        setUpdateInfo(null);
      }

      setLastChecked(new Date());
    } catch (err) {
      console.error("Error checking for updates:", err);
      setError(err.message);
    } finally {
      setIsChecking(false);
      checkInProgress.current = false;
    }
  }, []);

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
    if (autoCheck) {
      checkForUpdates();
    }
  }, [autoCheck]);

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
