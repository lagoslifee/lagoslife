import { clubNowPlaying, SONG_REQUEST, type ClubMusicState, type ClubSong } from "@lagos-living/shared";
import { useEffect, useRef, useState } from "react";
import { api, naira } from "../api";

type YtPlayer = {
  loadVideoById(options: { videoId: string; startSeconds: number }): void;
  playVideo(): void;
  pauseVideo(): void;
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
export type SongRequests = {
  state: ClubMusicState | null;
  balance: number;
  sync: () => void;
  request: (songId: string) => void;
  decide: (requestId: string, approve: boolean) => void;
};

export function ClubRadio({ clubId, volume, onPlaying, requests }: { clubId: string; volume: number; onPlaying: (playing: boolean) => void; requests?: SongRequests }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YtPlayer | null>(null);
  const [now, setNow] = useState(() => clubNowPlaying(clubId, Date.now()));
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(true);
  const playingRef = useRef(onPlaying);
  playingRef.current = onPlaying;
  const requestPlaying = useRef(false);

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
    // Buffering and stalls flicker in and out; only a set that stays stopped hands back to the game's own beat.
    let silent: ReturnType<typeof setTimeout> | undefined;
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
              clearTimeout(silent);
              if (event.data === PLAYING) playingRef.current(true);
              else silent = setTimeout(() => live && !requestPlaying.current && playingRef.current(false), event.data === ENDED ? 0 : 2_500);
            },
            onError: () => playingRef.current(false),
          },
        });
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      clearTimeout(silent);
      playingRef.current(false);
      player.current?.destroy();
      player.current = null;
    };
    // Volume changes are applied below without rebuilding the player.
  }, [clubId, open]);


  const requested = requests?.state?.playing ?? null;
  const [requestLive, setRequestLive] = useState(false);
  requestPlaying.current = requestLive;
  const audio = useRef<HTMLAudioElement | null>(null);
  const syncRef = useRef(requests?.sync);
  syncRef.current = requests?.sync;

  useEffect(() => {
    syncRef.current?.();
  }, [clubId]);

  useEffect(() => {
    if (!requested || !open) {
      setRequestLive(false);
      return;
    }
    const element = new Audio(api.songUrl(requested.songId));
    element.preload = "auto";
    audio.current = element;
    let live = true;
    const start = () => {
      if (!live) return;
      const into = (Date.now() - requested.startedAt) / 1000;
      if (into >= requested.seconds) return;
      element.currentTime = Math.max(0, into);
      void element.play().then(() => {
        if (!live) return;
        setRequestLive(true);
        player.current?.pauseVideo();
        playingRef.current(true);
      }).catch(() => live && setRequestLive(false));
    };
    const wait = Math.max(0, requested.startedAt - Date.now());
    const timer = setTimeout(start, wait);
    const stop = setTimeout(() => live && setRequestLive(false), wait + requested.seconds * 1000 + 500);
    return () => {
      live = false;
      clearTimeout(timer);
      clearTimeout(stop);
      element.pause();
      element.removeAttribute("src");
      audio.current = null;
      setRequestLive(false);
    };
  }, [requested?.id, requested?.startedAt, open]);

  useEffect(() => {
    if (requestLive) return;
    player.current?.loadVideoById({ videoId: now.track.videoId, startSeconds: clubNowPlaying(clubId, Date.now()).seconds });
  }, [requestLive, now.index, clubId, now.track.videoId]);

  useEffect(() => {
    player.current?.setVolume(Math.round(volume * 100));
    if (audio.current) audio.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume, requestLive]);

  return (
    <aside className="club-radio" data-testid="club-radio">
      <header>
        <div>
          <small>{requestLive && requested ? `REQUESTED BY ${requested.byName.toUpperCase()}` : "NOW PLAYING"}</small>
          <strong>{requestLive && requested ? requested.title : now.track.title}</strong>
          <span>{requestLive && requested ? requested.artist : now.track.artist}</span>
        </div>
        <button className="icon-button" onClick={() => setOpen((current) => !current)} aria-label={open ? "Turn the DJ off" : "Turn the DJ on"}>
          {open ? "■" : "▶"}
        </button>
      </header>
      {failed ? <p className="muted small">The DJ's set needs YouTube, which isn't reachable right now.</p> : open && <div className="club-radio-player" ref={host} hidden={requestLive} />}
      {requestLive && <div className="club-radio-request" aria-hidden="true"><span className="vinyl" /><span className="bars"><i /><i /><i /><i /><i /></span></div>}
      {open && !failed && !requestLive && <p className="muted small">Tap play if your device blocks autoplay.</p>}
      {requestLive && <p className="muted small" data-testid="request-playing">🎵 Playing a request · the DJ's set carries on after.</p>}
      {requests && <SongDesk requests={requests} />}
    </aside>
  );
}

/** Request a song for a tip, see the DJ's list, and, on the decks as a guest DJ, approve or pass on requests. */
function SongDesk({ requests }: { requests: SongRequests }) {
  const [picking, setPicking] = useState(false);
  const [songs, setSongs] = useState<ClubSong[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = requests.state;
  useEffect(() => {
    if (!picking || songs) return;
    api.songs().then(setSongs).catch((failure: Error) => setError(failure.message));
  }, [picking, songs]);
  const mine = state?.queue.some((entry) => entry.mine) ?? false;
  const pending = state?.dj.you ? state.queue.filter((entry) => entry.status === "pending" && !entry.mine) : [];
  return (
    <div className="song-desk" data-testid="song-desk">
      {state && (
        <p className="muted small">
          🎧 {state.dj.name}{state.dj.guest ? " (guest DJ)" : ""} on the decks{state.queue.length ? ` · ${state.queue.length} on the list` : ""}
        </p>
      )}
      {pending.length > 0 && (
        <ul className="song-pending" data-testid="dj-requests">
          {pending.map((entry) => (
            <li key={entry.id}>
              <span><strong>{entry.title}</strong> · {entry.artist}<small> for {entry.byName}</small></span>
              <button className="primary" onClick={() => requests.decide(entry.id, true)} data-testid={`dj-approve-${entry.id}`}>Play it</button>
              <button onClick={() => requests.decide(entry.id, false)}>Pass</button>
            </li>
          ))}
        </ul>
      )}
      {state && state.queue.length > 0 && (
        <ol className="song-queue">
          {state.queue.slice(0, 4).map((entry) => (
            <li key={entry.id} className={entry.mine ? "mine" : ""}>
              {entry.title} <small>· {entry.byName} · {entry.status === "pending" ? "waiting for the DJ" : "approved"}</small>
            </li>
          ))}
        </ol>
      )}
      <button className="secondary" disabled={mine} onClick={() => setPicking((open) => !open)} data-testid="request-song">
        {mine ? "Your request is on the list" : picking ? "Close the song list" : `🎵 Request a song · ${naira(SONG_REQUEST.tip)} tip`}
      </button>
      {picking && !mine && (
        <div className="song-picker" data-testid="song-picker">
          {error && <p className="error-text small">{error}</p>}
          {songs && songs.length === 0 && <p className="muted small">The DJ hasn't got any request songs yet. Check back soon.</p>}
          {songs?.map((song) => (
            <button
              key={song.id}
              disabled={requests.balance < SONG_REQUEST.tip}
              onClick={() => {
                requests.request(song.id);
                setPicking(false);
              }}
            >
              <strong>{song.title}</strong>
              <span>{song.artist} · {Math.floor(song.seconds / 60)}:{String(song.seconds % 60).padStart(2, "0")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
