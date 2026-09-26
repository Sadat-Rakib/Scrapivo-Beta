import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type HeroVideoHandle = {
  play: () => void;
  pause: () => void;
  setRate: (rate: number) => void;
};

type Props = {
  src: string;
  /** Start paused on first frame. False = ambient loop from mount. */
  startPaused?: boolean;
  /** Always loop when playing (Watches clock never stops). */
  loop?: boolean;
  /** Framing: cover crops to fill, contain shows the whole subject. */
  fit?: "cover" | "contain";
  /** Ambient playback speed (1 = normal). Applied live when it changes. */
  rate?: number;
  className?: string;
};

/**
 * Full-bleed "not a video" treatment: blend-mode screen over pure black so
 * footage-black disappears, no chrome, no spinner. Holds the first frame
 * while paused; hides itself if the file fails to load. Reduced-motion
 * users always get the static first frame. Keep opacity modest via
 * className (e.g. opacity-60) — the footage is ambience, never the focus.
 */
export const HeroVideo = forwardRef<HeroVideoHandle, Props>(function HeroVideo(
  { src, startPaused = false, loop = true, fit = "cover", rate = 1, className = "" },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    try {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        setReducedMotion(true);
      }
    } catch {
      // matchMedia unavailable — play normally.
    }
  }, []);

  useImperativeHandle(ref, () => ({
    play: () => {
      if (reducedMotion) return;
      void videoRef.current?.play().catch(() => {
        // Autoplay policy or missing data — stay on held frame.
      });
    },
    pause: () => {
      videoRef.current?.pause();
    },
    setRate: (r: number) => {
      if (videoRef.current) {
        try {
          videoRef.current.playbackRate = r;
        } catch {
          // Older engines may reject — motion continues at normal speed.
        }
      }
    },
  }));

  useEffect(() => {
    const el = videoRef.current;
    if (!el || failed || reducedMotion) return;
    try {
      el.playbackRate = rate;
    } catch {
      // Ignore — motion continues at normal speed.
    }
    if (startPaused) {
      el.pause();
    } else {
      void el.play().catch(() => {
        // Autoplay blocked — first frame still holds via preload.
      });
    }
  }, [failed, reducedMotion, startPaused, rate]);

  if (failed) return null;

  return (
    <video
      ref={videoRef}
      src={src}
      muted
      playsInline
      disablePictureInPicture
      preload="auto"
      loop={loop}
      aria-hidden="true"
      tabIndex={-1}
      onError={() => setFailed(true)}
      className={`pointer-events-none absolute inset-0 h-full w-full mix-blend-screen ${
        fit === "contain" ? "object-contain" : "object-cover"
      } ${className}`}
    />
  );
});
