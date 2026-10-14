import type { ClubSong, SongVenue } from "@lagos-living/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";

/** Which song is on and how far in, from the clock alone, so everyone at the party hears the same moment. */
export function slot(playlist: ClubSong[], now: number) {
  const total = playlist.reduce((sum, song) => sum + song.seconds, 0);
  let at = (now / 1000) % total;
  for (const [index, song] of playlist.entries()) {
    if (at < song.seconds) return { index, song, offset: at };
    at -= song.seconds;
  }
  return { index: 0, song: playlist[0]!, offset: 0 };
}

/**
 * Plays the songs the music team filed under `venue` on a loop shared by everyone there. With none uploaded it shows
 * `fallback` instead (the club's own set), or nothing.
 */
export function SongRotation({ venue, volume, label, fallback = null }: { venue: SongVenue; volume: number; label: string; fallback?: ReactNode }) {
  const [playlist, setPlaylist] = useState<ClubSong[] | null>(null);
  const [now, setNow] = useState<ClubSong | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [on, setOn] = useState(true);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let live = true;
    api.songs(venue)
      .then((songs) => live && setPlaylist([...songs].sort((a, b) => a.id.localeCompare(b.id))))
      .catch(() => live && setPlaylist([]));
    return () => {
      live = false;
    };
  }, [venue]);

  useEffect(() => {
    if (!playlist?.length || !on) return;
    const element = new Audio();
    element.preload = "auto";
    audio.current = element;
    let live = true;
    const play = () => {
      if (!live) return;
      const { song, offset } = slot(playlist, Date.now());
      setNow(song);
      element.src = api.songUrl(song.id);
      element.currentTime = offset;
      element.volume = Math.max(0, Math.min(1, volume));
      element.play().then(() => setBlocked(false), () => live && setBlocked(true));
    };
    element.addEventListener("ended", play);
    // A stalled or dropped stream picks the shared loop back up rather than going quiet.
    element.addEventListener("error", () => window.setTimeout(play, 3_000));
    play();
    return () => {
      live = false;
      element.pause();
      element.removeAttribute("src");
      audio.current = null;
    };
  }, [playlist, on]);

  useEffect(() => {
    if (audio.current) audio.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);

  if (playlist === null) return null;
  if (!playlist.length) return <>{fallback}</>;
  return (
    <aside className="club-radio song-rotation" data-testid={`songs-${venue}`}>
      <header>
        <div>
          <small>{label}</small>
          <strong>{on ? (now?.title ?? "…") : "Music off"}</strong>
          {on && now && <span>{now.artist}</span>}
        </div>
        <button className="icon-button" onClick={() => setOn((current) => !current)} aria-label={on ? "Turn the music off" : "Turn the music on"}>
          {on ? "■" : "▶"}
        </button>
      </header>
      {on && blocked && (
        <button className="secondary" onClick={() => void audio.current?.play().then(() => setBlocked(false), () => undefined)}>
          🔊 Tap to hear the music
        </button>
      )}
    </aside>
  );
}
