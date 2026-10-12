import type { PlayerSettings } from "@lagos-living/shared";

/**
 * Procedural ambience (traffic bed, distant horns, market murmur) so the
 * street never sounds empty, plus spoken danfo announcements. Audio starts on
 * the first user gesture because browsers block autoplay.
 */
export class CityAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private traffic: BiquadFilterNode | null = null;
  private settings: PlayerSettings;
  private nextHorn = 0;
  private wantedClub: { bpm: number } | null = null;
  private club: { bpm: number; gain: GainNode; nextStep: number; step: number } | null = null;

  constructor(settings: PlayerSettings) {
    this.settings = settings;
    const unlock = () => {
      this.start();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", this.visibility);
  }

  /** A suspended context stops the audio thread, so a backgrounded tab doesn't keep the phone working. */
  private visibility = () => {
    if (!this.context) return;
    if (document.hidden) void this.context.suspend();
    else void this.context.resume();
  };

  private start() {
    if (this.context) return;
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = new AudioCtor();
    this.context = context;
    this.master = context.createGain();
    this.master.connect(context.destination);
    this.ambience = context.createGain();
    this.ambience.connect(this.master);
    const length = context.sampleRate * 4;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[index] = last * 3.5;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    this.traffic = context.createBiquadFilter();
    this.traffic.type = "lowpass";
    this.traffic.frequency.value = 420;
    noise.connect(this.traffic);
    this.traffic.connect(this.ambience);
    noise.start();
    this.apply(this.settings);
    if (this.wantedClub) this.setClub(this.wantedClub);
  }

  apply(settings: PlayerSettings) {
    this.settings = settings;
    if (!this.master || !this.ambience) return;
    this.master.gain.value = settings.muted ? 0 : settings.masterVolume;
    this.ambience.gain.value = settings.ambienceVolume * 0.5;
  }

  /** Starts a synthesised four-on-the-floor groove for the club the player is in, or stops it with null. */
  setClub(club: { bpm: number } | null) {
    this.wantedClub = club;
    if (this.club) {
      const { gain } = this.club;
      gain.gain.setTargetAtTime(0, this.context!.currentTime, 0.2);
      setTimeout(() => gain.disconnect(), 1500);
      this.club = null;
    }
    if (!club || !this.context || !this.master) return;
    const gain = this.context.createGain();
    gain.gain.value = 0.5;
    gain.connect(this.master);
    this.club = { bpm: club.bpm, gain, nextStep: this.context.currentTime + 0.1, step: 0 };
  }

  private scheduleClub() {
    const context = this.context;
    const club = this.club;
    if (!context || !club) return;
    const sixteenth = 60 / club.bpm / 4;
    const bass = [55, 55, 65.4, 49];
    while (club.nextStep < context.currentTime + 0.25) {
      const at = club.nextStep;
      const step = club.step % 16;
      if (step % 4 === 0) this.tone(club.gain, "sine", 120, 45, at, 0.22, 0.9);
      if (step % 4 === 2) this.noiseHit(club.gain, at, 0.05, 0.18);
      if (step === 3 || step === 6 || step === 11 || step === 14) this.tone(club.gain, "triangle", 330, 300, at, 0.08, 0.12);
      if (step % 8 === 0 || step === 10) this.tone(club.gain, "sawtooth", bass[Math.floor(club.step / 16) % 4]!, bass[Math.floor(club.step / 16) % 4]!, at, sixteenth * 3, 0.16);
      club.nextStep += sixteenth;
      club.step += 1;
    }
  }

  private tone(out: AudioNode, type: OscillatorType, from: number, to: number, at: number, length: number, volume: number) {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, at);
    oscillator.frequency.exponentialRampToValueAtTime(to, at + length);
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + length);
    oscillator.connect(gain);
    gain.connect(out);
    oscillator.start(at);
    oscillator.stop(at + length + 0.02);
  }

  private noiseHit(out: AudioNode, at: number, length: number, volume: number) {
    const context = this.context!;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * length), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 6000;
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(at);
  }

  /** Called each frame with how busy the surroundings are (0 indoors, 1 on Admiralty Way). */
  update(now: number, busyness: number) {
    this.scheduleClub();
    if (!this.context || !this.traffic || !this.ambience) return;
    this.traffic.frequency.value = 220 + busyness * 520;
    this.ambience.gain.value = this.settings.ambienceVolume * (0.12 + busyness * 0.45);
    if (busyness > 0.2 && now > this.nextHorn) {
      this.nextHorn = now + 5000 + Math.random() * 12000;
      this.horn(0.25 + Math.random() * 0.3);
    }
  }

  horn(volume = 0.6) {
    if (!this.context || !this.ambience) return;
    const context = this.context;
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.connect(this.ambience);
    const start = context.currentTime;
    const pattern = Math.random() > 0.5 ? [0, 0.22] : [0];
    for (const offset of pattern) {
      for (const frequency of [415, 498]) {
        const oscillator = context.createOscillator();
        oscillator.type = "square";
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(start + offset);
        oscillator.stop(start + offset + 0.16);
      }
      gain.gain.setValueAtTime(volume * 0.08, start + offset);
      gain.gain.setValueAtTime(0, start + offset + 0.16);
    }
  }

  private cabin: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

  /** Low engine rumble while seated on a flight; `level` 0 stops it. */
  setCabinHum(level: number) {
    const context = this.context;
    if (level <= 0 || !context || !this.master) {
      if (this.cabin && context) {
        const { source, gain } = this.cabin;
        gain.gain.setTargetAtTime(0, context.currentTime, 0.3);
        setTimeout(() => source.stop(), 1_500);
      }
      this.cabin = null;
      return;
    }
    if (!this.cabin) {
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let index = 0; index < data.length; index += 1) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        data[index] = last * 3.5;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 420;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start();
      this.cabin = { source, gain };
    }
    this.cabin.gain.gain.setTargetAtTime(level * this.settings.ambienceVolume * 0.6, context.currentTime, 0.5);
  }

  /** The two-tone cabin chime before an announcement. */
  chime() {
    if (!this.context || !this.master) return;
    const at = this.context.currentTime + 0.02;
    this.tone(this.master, "sine", 880, 878, at, 0.5, 0.12);
    this.tone(this.master, "sine", 659, 657, at + 0.45, 0.7, 0.12);
  }

  announce(text: string) {
    if (!("speechSynthesis" in window) || this.settings.dialogueVolume <= 0) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = this.settings.muted ? 0 : this.settings.dialogueVolume * this.settings.masterVolume;
    utterance.rate = 1.05;
    const voice = speechSynthesis.getVoices().find((candidate) => candidate.lang === "en-NG") ?? speechSynthesis.getVoices().find((candidate) => candidate.lang.startsWith("en"));
    if (voice) utterance.voice = voice;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  dispose() {
    document.removeEventListener("visibilitychange", this.visibility);
    void this.context?.close();
  }
}
