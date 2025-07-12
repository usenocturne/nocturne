import { useState, useEffect, useCallback, useRef } from "react";
// import axios from 'axios';

const compareVersions = (v1, v2) => {
  const parseVersion = (version) => {
    const match = version.match(/^(\d+\.\d+\.\d+)(?:-(.+))?$/);
    if (!match) {
      return { base: version, preRelease: null };
    }
    return {
      base: match[1],
      preRelease: match[2] || null,
    };
  };

  const v1Parsed = parseVersion(v1);
  const v2Parsed = parseVersion(v2);

  const v1BaseParts = v1Parsed.base.split(".").map(Number);
  const v2BaseParts = v2Parsed.base.split(".").map(Number);

  for (let i = 0; i < Math.max(v1BaseParts.length, v2BaseParts.length); i++) {
    const v1Part = v1BaseParts[i] || 0;
    const v2Part = v2BaseParts[i] || 0;

    if (v1Part > v2Part) return 1;
    if (v1Part < v2Part) return -1;
  }

  if (!v1Parsed.preRelease && !v2Parsed.preRelease) return 0;

  if (!v1Parsed.preRelease && v2Parsed.preRelease) return 1;
  if (v1Parsed.preRelease && !v2Parsed.preRelease) return -1;

  if (v1Parsed.preRelease > v2Parsed.preRelease) return 1;
  if (v1Parsed.preRelease < v2Parsed.preRelease) return -1;

  return 0;
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
          //const updateJsonResponse = await axios.get(`https://cors-anywhere.herokuapp.com/${updateJsonAsset.browser_download_url}`, {headers: {'Content-Type': 'application/json'}});
          console.log(updateJsonResponse);
          if (!updateJsonResponse.ok) continue;

          const updateJson = await updateJsonResponse.json();
          console.log(updateJson);

          const releaseData = {
            ...updateJson,
            tag: release.tag_name,
            releaseNotes: release.body,
            releaseDate: release.published_at,
            releaseSize: release.assets.find(
              (a) => a.name === updateJson.files.full,
            ).size,
            assetUrls: {},
          };

          for (const [key, fileName] of Object.entries(updateJson.files)) {
            const asset = release.assets.find((a) => a.name === fileName);
            if (asset) {
              releaseData.assetUrls[key] = asset.browser_download_url;
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
        compareVersions(currentVersion, release.minimumVersion) >= 0,
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
            compareVersions(currentStep.version, release.minimumVersion) >= 0,
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
