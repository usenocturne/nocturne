import { useState, useEffect, useRef } from "react";

export function usePlaybackProgress(currentPlayback) {
    const [estimatedProgress, setEstimatedProgress] = useState(0);
    const progressIntervalRef = useRef(null);
    const lastUpdateTimeRef = useRef(Date.now());
    const lastProgressRef = useRef(0);

    useEffect(() => {
        if (currentPlayback?.item) {
            const newProgress = (currentPlayback.progress_ms / currentPlayback.item.duration_ms) * 100;
            setEstimatedProgress(newProgress);
            lastProgressRef.current = newProgress;
            lastUpdateTimeRef.current = Date.now();

            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }

            if (currentPlayback.is_playing) {
                progressIntervalRef.current = setInterval(() => {
                    const timeDiff = Date.now() - lastUpdateTimeRef.current;
                    const updatedProgress = ((currentPlayback.progress_ms + timeDiff) / currentPlayback.item.duration_ms) * 100;

                    if (updatedProgress <= 100) {
                        setEstimatedProgress(updatedProgress);
                        lastProgressRef.current = updatedProgress;
                    } else {
                        clearInterval(progressIntervalRef.current);
                    }
                }, 100);
            }
        } else {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }
            setEstimatedProgress(0);
            lastProgressRef.current = 0;
        }

        return () => {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
            }
        };
    }, [currentPlayback?.is_playing, currentPlayback?.progress_ms, currentPlayback?.item?.duration_ms]);

    return estimatedProgress;
} 