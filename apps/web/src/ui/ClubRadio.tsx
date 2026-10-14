import { hash01, SONG_REQUEST, type ClubMusicState, type ClubSong } from "@lagos-living/shared";
import { useEffect, useRef, useState } from "react";
import { api, naira } from "../api";
import { slot } from "./SongRotation";

export type SongRequests = {
  state: ClubMusicState | null;
  balance: number;
  sync: () => void;
  request: (songId: string) => void;
  decide: (requestId: string, approve: boolean) => void;
};

type Track = { songId: string; title: string; artist: string; offset: number; requestedBy: string | null };

/**
 * The club's DJ set: the songs the music team uploaded for clubs, on a loop shared by everyone in the same club (each
 * club starts somewhere different in it), and an approved request plays over it for its length. `onPlaying` lets the
 * game drop its synthesised beat while a song is actually coming out of the speakers; with nothing uploaded the beat
 * carries the night.
 */
export function ClubRadio({ clubId, volume, onPlaying, requests }: { clubId: string; volume: number; onPlaying: (playing: boolean) => void; requests?: SongRequests }) {
  const [playlist, setPlaylist] = useState<ClubSong[] | null>(null);
  const [open, setOpen] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [track, setTrack] = useState<Track | null>(null);
  const [requestLive, setRequestLive] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const playingRef = useRef(onPlaying);
  playingRef.current = onPlaying;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const syncRef = useRef(requests?.sync);
  syncRef.current = requests?.sync;
  const requested = requests?.state?.playing ?? null;

  useEffect(() => {
    let live = true;
    api
      .songs("club")
      .then((songs) => live && setPlaylist(songs.filter((song) => song.seconds > 0).sort((a, b) => a.id.localeCompare(b.id))))
      .catch(() => live && setPlaylist([]));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    syncRef.current?.();
  }, [clubId]);

  useEffect(() => {
    if (!requested) {
      setRequestLive(false);
      return;
    }
    const startIn = requested.startedAt - Date.now();
    const endIn = startIn + requested.seconds * 1_000;
    if (endIn <= 0) {
      setRequestLive(false);
      return;
    }
    const begin = setTimeout(() => setRequestLive(true), Math.max(0, startIn));
    const end = setTimeout(() => setRequestLive(false), endIn + 300);
    return () => {
      clearTimeout(begin);
      clearTimeout(end);
      setRequestLive(false);
    };
  }, [requested?.id, requested?.startedAt, requested?.seconds]);

  useEffect(() => {
    if (!open || playlist === null) {
      playingRef.current(false);
      return;
    }
    const element = new Audio();
    element.preload = "auto";
    element.setAttribute("playsinline", "");
    audio.current = element;
    let live = true;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const shift = hash01(`club-set:${clubId}`) * 6 * 3_600_000;
    const pick = (): Track | null => {
      if (requestLive && requested) {
        return { songId: requested.songId, title: requested.title, artist: requested.artist, offset: Math.max(0, (Date.now() - requested.startedAt) / 1_000), requestedBy: requested.byName };
      }
      if (!playlist.length) return null;
      const { song, offset } = slot(playlist, Date.now() + shift);
      return { songId: song.id, title: song.title, artist: song.artist, offset, requestedBy: null };
    };
    let loaded = "";
    const play = () => {
      if (!live) return;
      const next = pick();
      setTrack(next);
      if (!next) {
        playingRef.current(false);
        return;
      }
      if (loaded !== next.songId) {
        loaded = next.songId;
        element.src = api.songUrl(next.songId);
      }
      const seek = () => {
        if (Math.abs(element.currentTime - next.offset) > 1.5) element.currentTime = next.offset;
      };
      if (element.readyState >= 1) seek();
      else element.addEventListener("loadedmetadata", seek, { once: true });
      element.volume = Math.max(0, Math.min(1, volumeRef.current));
      element.play().then(
        () => live && setBlocked(false),
        () => live && setBlocked(true),
      );
    };
    // Buffering flickers; only a set that stays stopped hands back to the game's beat.
    const silent = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => live && element.paused && playingRef.current(false), 2_500);
    };
    element.addEventListener("playing", () => {
      clearTimeout(quiet);
      playingRef.current(true);
    });
    element.addEventListener("pause", silent);
    element.addEventListener("ended", play);
    // A dropped stream picks the shared loop back up where everyone else is, rather than going quiet.
    element.addEventListener("error", () => {
      loaded = "";
      silent();
      clearTimeout(retry);
      retry = setTimeout(play, 2_000);
    });
    const wake = () => {
      if (!document.hidden && element.paused) play();
    };
    document.addEventListener("visibilitychange", wake);
    play();
    return () => {
      live = false;
      clearTimeout(quiet);
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", wake);
      element.pause();
      element.removeAttribute("src");
      element.load();
      audio.current = null;
      playingRef.current(false);
    };
  }, [open, playlist, requestLive, requested?.id, clubId]);

  useEffect(() => {
    if (audio.current) audio.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);

  const empty = playlist !== null && !playlist.length && !requestLive;
  return (
    <aside className="club-radio" data-testid="club-radio">
      <header>
        <div>
          <small>{track?.requestedBy ? `REQUESTED BY ${track.requestedBy.toUpperCase()}` : "NOW PLAYING"}</small>
          <strong>{!open ? "DJ off" : track ? track.title : empty ? "The DJ's own mix" : "…"}</strong>
          {open && track && <span>{track.artist}</span>}
        </div>
        <button className="icon-button" onClick={() => setOpen((current) => !current)} aria-label={open ? "Turn the DJ off" : "Turn the DJ on"}>
          {open ? "■" : "▶"}
        </button>
      </header>
      {open && track && (
        <div className="club-radio-request" aria-hidden="true">
          <span className="vinyl" />
          <span className="bars"><i /><i /><i /><i /><i /></span>
        </div>
      )}
      {open && blocked && (
        <button className="secondary" onClick={() => void audio.current?.play().then(() => setBlocked(false), () => undefined)} data-testid="club-radio-unmute">
          🔊 Tap to hear the music
        </button>
      )}
      {open && empty && <p className="muted small">No club songs uploaded yet, so the DJ is playing the house beat.</p>}
      {track?.requestedBy && <p className="muted small" data-testid="request-playing">🎵 Playing a request · the DJ's set carries on after.</p>}
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
