"use client";

import { useState, useEffect } from "react";
import { Field, Label, Switch } from "@headlessui/react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabaseClient";

export default function Settings({ onOpenDonationModal }) {
  const router = useRouter();
  const [trackNameScrollingEnabled, setTrackNameScrollingEnabled] = useState(
    () => {
      const storedValue = localStorage.getItem("trackNameScrollingEnabled");
      return storedValue !== null ? storedValue === "true" : true;
    }
  );

  const [lyricsMenuEnabled, setLyricsMenuEnabled] = useState(() => {
    const storedValue = localStorage.getItem("lyricsMenuEnabled");
    return storedValue !== null ? storedValue === "true" : true;
  });

  const [autoRedirectEnabled, setAutoRedirectEnabled] = useState(() => {
    const storedValue = localStorage.getItem("autoRedirectEnabled");
    return storedValue !== null ? storedValue === "true" : false;
  });

  const [elapsedTimeEnabled, setElapsedTimeEnabled] = useState(() => {
    const storedValue = localStorage.getItem("elapsedTimeEnabled");
    return storedValue !== null ? storedValue === "true" : true;
  })

  useEffect(() => {
    localStorage.setItem(
      "trackNameScrollingEnabled",
      trackNameScrollingEnabled.toString()
    );
  }, [trackNameScrollingEnabled]);

  useEffect(() => {
    localStorage.setItem("lyricsMenuEnabled", lyricsMenuEnabled.toString());
  }, [lyricsMenuEnabled]);

  useEffect(() => {
    localStorage.setItem("autoRedirectEnabled", autoRedirectEnabled.toString());
  }, [autoRedirectEnabled]);

  useEffect(() => {
    localStorage.setItem("elapsedTimeEnabled", elapsedTimeEnabled.toString());
  }, [elapsedTimeEnabled]);

  useEffect(() => {
    if (localStorage.getItem("trackNameScrollingEnabled") === null) {
      localStorage.setItem("trackNameScrollingEnabled", "true");
    }
    if (localStorage.getItem("lyricsMenuEnabled") === null) {
      localStorage.setItem("lyricsMenuEnabled", "true");
    }
    if (localStorage.getItem("autoRedirectEnabled") === null) {
      localStorage.setItem("autoRedirectEnabled", "false");
    }
    if (localStorage.getItem("elapsedTimeEnabled") === null) {
      localStorage.setItem("elapsedTimeEnabled", "true");
    }
  }, []);

  const handleSignOut = async () => {
    try {
      const refreshToken = localStorage.getItem("spotifyRefreshToken");
      const tempId = localStorage.getItem("spotifyTempId");
      const authType = localStorage.getItem("spotifyAuthType");

      if (authType === "custom" && refreshToken && tempId) {
        const { error } = await supabase
          .from("spotify_credentials")
          .delete()
          .match({
            temp_id: tempId,
            refresh_token: refreshToken,
          });

        if (error) {
          console.error("Error removing credentials from database:", error);
        }
      }

      localStorage.removeItem("spotifyAccessToken");
      localStorage.removeItem("spotifyRefreshToken");
      localStorage.removeItem("spotifyTokenExpiry");
      localStorage.removeItem("spotifyAuthType");
      localStorage.removeItem("spotifyTempId");

      router.push("/").then(() => {
        window.location.reload();
      });
    } catch (error) {
      console.error("Error during sign out:", error);
      localStorage.clear();
      router.push("/").then(() => {
        window.location.reload();
      });
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="pt-12 space-y-8">
        <div>
          <Field className="flex items-center">
            <Switch
              checked={trackNameScrollingEnabled}
              onChange={setTrackNameScrollingEnabled}
              className="group relative inline-flex h-11 w-20 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none data-[checked]:bg-white/40"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none inline-block h-10 w-10 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out group-data-[checked]:translate-x-9"
              />
            </Switch>
            <Label as="span" className="ml-3 text-sm">
              <span className="text-[32px] font-[580] text-white tracking-tight">
                Track Name Scrolling
              </span>
            </Label>
          </Field>
          <p className="pt-4 text-[28px] font-[560] text-white/60 max-w-[380px] tracking-tight">
            Enable or disable the scrolling animation for the track name in the
            player.
          </p>
        </div>
        <div>
          <Field className="flex items-center">
            <Switch
              checked={lyricsMenuEnabled}
              onChange={setLyricsMenuEnabled}
              className="group relative inline-flex h-11 w-20 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none data-[checked]:bg-white/40"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none inline-block h-10 w-10 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out group-data-[checked]:translate-x-9"
              />
            </Switch>
            <Label as="span" className="ml-3 text-sm">
              <span className="text-[32px] font-[580] text-white tracking-tight">
                Lyrics Menu Option
              </span>
            </Label>
          </Field>
          <p className="pt-4 text-[28px] font-[560] text-white/60 max-w-[380px] tracking-tight">
            Enable or disable the lyrics menu option in the player.
          </p>
        </div>
        <div>
          <Field className="flex items-center">
            <Switch
              checked={autoRedirectEnabled}
              onChange={setAutoRedirectEnabled}
              className="group relative inline-flex h-11 w-20 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none data-[checked]:bg-white/40"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none inline-block h-10 w-10 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out group-data-[checked]:translate-x-9"
              />
            </Switch>
            <Label as="span" className="ml-3 text-sm">
              <span className="text-[32px] font-[580] text-white tracking-tight leading-normal">
                Idle Redirect
              </span>
            </Label>
          </Field>
          <p className="pt-4 text-[28px] font-[560] text-white/60 max-w-[380px] tracking-tight">
            Automatically redirect to the Now Playing screen after one minute of
            inactivity.
          </p>
        </div>
        <div>
          <Field className="flex items-center">
            <Switch
              checked={elapsedTimeEnabled}
              onChange={setElapsedTimeEnabled}
              className="group relative inline-flex h-11 w-20 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none data-[checked]:bg-white/40"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none inline-block h-10 w-10 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out group-data-[checked]:translate-x-9"
              />
            </Switch>
            <Label as="span" className="ml-3 text-sm">
              <span className="text-[32px] font-[580] text-white tracking-tight">
                Show Time Elapsed
              </span>
            </Label>
          </Field>
          <p className="pt-4 text-[28px] font-[560] text-white/60 max-w-[380px] tracking-tight">
            Display the elapsed track time or remaining track time below the progress bar.
          </p>
        </div>
        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute inset-0 flex items-center"
          >
            <div className="w-full border-t border-gray-300" />
          </div>
        </div>
        <div className="space-y-4">
          <button
            onClick={onOpenDonationModal}
            className="bg-white/10 hover:bg-white/20 w-80 transition-colors duration-200 rounded-[12px] px-6 py-3 mt-10"
          >
            <span className="text-[32px] font-[580] text-white tracking-tight">
              Support Nocturne
            </span>
          </button>
          <p className="text-[28px] font-[560] text-white/60 max-w-[380px] tracking-tight">
            Help keep Nocturne running through donations. Thank you!
          </p>
        </div>
        <div className="space-y-4">
          <button
            onClick={handleSignOut}
            className="bg-white/10 hover:bg-white/20 w-80 transition-colors duration-200 rounded-[12px] px-6 py-3"
          >
            <span className="text-[32px] font-[580] text-white tracking-tight">
              Sign Out
            </span>
          </button>
          <p className="text-[28px] font-[560] text-white/60 max-w-[380px] tracking-tight">
            Sign out and reset authentication settings.
          </p>
        </div>
        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute inset-0 flex items-center"
          >
            <div className="w-full border-t border-gray-300" />
          </div>
        </div>
        <div>
          <p className="pt-4 pb-4 text-[20px] font-[560] text-white/60 max-w-[380px] tracking-tight">
            All album artwork, artist images, and track metadata are provided by
            Spotify Technology S.A. These materials are protected by
            intellectual property rights owned by Spotify or its licensors.
          </p>
        </div>
      </div>
    </div>
  );
}
