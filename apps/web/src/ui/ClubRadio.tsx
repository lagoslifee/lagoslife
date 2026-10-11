import { clubNowPlaying } from "@lagos-living/shared";
import { useEffect, useRef, useState } from "react";

type YtPlayer = {
  loadVideoById(options: { videoId: string; startSeconds: number }): void;
  playVideo(): void;
  setVolume(volume: number): void;
  destroy(): void;
};
type YtNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      width: string | number;
      height: string | number;
      videoId: string;
      playerVars: Record<string, number | string>;
      events: { onReady?: () => void; onStateChange?: (event: { data: number }) => void; onError?: () => void };
    },
  ) => YtPlayer;
};

const PLAYING = 1;
const ENDED = 0;

let apiPromise: Promise<YtNamespace> | null = null;
function youtubeApi() {
  apiPromise ??= new Promise<YtNamespace>((resolve, reject) => {
    const host = window as unknown as { YT?: YtNamespace & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
    if (host.YT?.Player) return resolve(host.YT);
    host.onYouTubeIframeAPIReady = () => resolve(host.YT!);
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("YouTube unavailable"));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

/**
 * The club's DJ set as YouTube's own player, kept visible (YouTube requires that) in a corner card. Everyone in the
 * same club is on the same track and position. `onPlaying` lets the game drop its synthesised beat while a song plays.
 */
export function ClubRadio({ clubId, volume, onPlaying }: { clubId: string; volume: number; onPlaying: (playing: boolean) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YtPlayer | null>(null);
  const [now, setNow] = useState(() => clubNowPlaying(clubId, Date.now()));
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(true);
  const playingRef = useRef(onPlaying);
  playingRef.current = onPlaying;

  useEffect(() => {
    const timer = setInterval(() => {
      const next = clubNowPlaying(clubId, Date.now());
      setNow((current) => (current.index === next.index ? current : next));
    }, 1_000);
    return () => clearInterval(timer);
  }, [clubId]);

  useEffect(() => {
    if (!open || !host.current) return;
    let live = true;
    const start = clubNowPlaying(clubId, Date.now());
    const target = document.createElement("div");
    host.current.replaceChildren(target);
    youtubeApi()
      .then((YT) => {
        if (!live) return;
        player.current = new YT.Player(target, {
          width: "100%",
          height: "100%",
          videoId: start.track.videoId,
          playerVars: { autoplay: 1, start: start.seconds, playsinline: 1, controls: 1, modestbranding: 1, rel: 0 },
          events: {
            onReady: () => player.current?.setVolume(Math.round(volume * 100)),
            onStateChange: (event) => {
              if (event.data === PLAYING) playingRef.current(true);
              else if (event.data === ENDED) playingRef.current(false);
            },
            onError: () => playingRef.current(false),
          },
        });
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      playingRef.current(false);
      player.current?.destroy();
      player.current = null;
    };
    // Volume changes are applied below without rebuilding the player.
  }, [clubId, open]);

  useEffect(() => {
    player.current?.loadVideoById({ videoId: now.track.videoId, startSeconds: clubNowPlaying(clubId, Date.now()).seconds });
  }, [now.index, clubId, now.track.videoId]);

  useEffect(() => {
    player.current?.setVolume(Math.round(volume * 100));
  }, [volume]);

  return (
    <aside className="club-radio" data-testid="club-radio">
      <header>
        <div>
          <small>NOW PLAYING</small>
          <strong>{now.track.title}</strong>
          <span>{now.track.artist}</span>
        </div>
        <button className="icon-button" onClick={() => setOpen((current) => !current)} aria-label={open ? "Turn the DJ off" : "Turn the DJ on"}>
          {open ? "■" : "▶"}
        </button>
      </header>
      {failed ? <p className="muted small">The DJ's set needs YouTube, which isn't reachable right now.</p> : open && <div className="club-radio-player" ref={host} />}
      {open && !failed && <p className="muted small">Tap play if your device blocks autoplay.</p>}
    </aside>
  );
}
