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

  private clubTimer: ReturnType<typeof setInterval> | null = null;
  private effects: GainNode | null = null;
  private motor: { low: OscillatorNode; high: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private stride = 0;
  private lastTap = 0;

  constructor(settings: PlayerSettings) {
    this.settings = settings;
    for (const type of ["pointerdown", "touchend", "click", "keydown"]) window.addEventListener(type, this.gesture, { passive: true });
    document.addEventListener("click", this.tapped, { capture: true, passive: true });
    document.addEventListener("visibilitychange", this.visibility);
  }

  /**
   * Phones suspend (iOS: "interrupted") the context for calls, notifications, the lock screen or another app's audio,
   * and only let it resume inside a user gesture, so every gesture checks rather than just the first.
   */
  private gesture = () => {
    if (!this.context) this.start();
    else if (this.context.state !== "running" && !document.hidden) {
      void this.context.resume().catch(() => undefined);
      this.unlock();
    }
  };

  /** iOS only opens the audio output after something is played inside the gesture itself, so play a blank tick. */
  private unlock() {
    const context = this.context;
    if (!context) return;
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, 22_050);
    source.connect(context.destination);
    source.start(0);
  }

  private tapped = (event: Event) => {
    const target = event.target as Element | null;
    if (!target?.closest?.("button, [role=button], a")) return;
    const now = performance.now();
    if (now - this.lastTap < 60 || !this.context || !this.effects) return;
    this.lastTap = now;
    const at = this.context.currentTime + 0.005;
    this.tone(this.effects, "sine", 1_400, 900, at, 0.05, 0.08);
  };

  /** A suspended context stops the audio thread, so a backgrounded tab doesn't keep the phone working. */
  private visibility = () => {
    if (!this.context) return;
    if (document.hidden) void this.context.suspend();
    else void this.context.resume().catch(() => undefined);
  };

  private start() {
    if (this.context) return;
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    // Without this iOS treats game audio as "ambient" and the ringer switch silences all of it.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = "playback";
      } catch {
        // Older WebKit exposes the object read-only.
      }
    }
    const context = new AudioCtor({ latencyHint: "interactive" });
    this.context = context;
    if (context.state !== "running") void context.resume().catch(() => undefined);
    this.unlock();
    context.addEventListener("statechange", () => {
      if (context.state !== "running" && context.state !== "closed" && !document.hidden) void context.resume().catch(() => undefined);
    });
    this.master = context.createGain();
    this.master.connect(context.destination);
    this.ambience = context.createGain();
    this.ambience.connect(this.master);
    this.effects = context.createGain();
    this.effects.gain.value = 0.9;
    this.effects.connect(this.master);
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
    if (!this.master || !this.ambience || !this.context) return;
    this.master.gain.setTargetAtTime(settings.muted ? 0 : settings.masterVolume, this.context.currentTime, 0.05);
    this.ambience.gain.setTargetAtTime(settings.ambienceVolume * 0.5, this.context.currentTime, 0.05);
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
    // Its own timer rather than the render loop: frames slow to 12 fps under the phone and stall while tiles load,
    // which used to leave gaps in the beat.
    this.clubTimer ??= setInterval(() => this.scheduleClub(), 100);
  }

  private scheduleClub() {
    const context = this.context;
    const club = this.club;
    if (!context || !club) {
      if (this.clubTimer) clearInterval(this.clubTimer);
      this.clubTimer = null;
      return;
    }
    const sixteenth = 60 / club.bpm / 4;
    const bass = [55, 55, 65.4, 49];
    // After a stall (suspended context, frozen tab) carry on from now instead of firing every missed step at once.
    if (club.nextStep < context.currentTime) club.nextStep = context.currentTime + 0.05;
    while (club.nextStep < context.currentTime + 0.6) {
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
    if (!this.context || !this.traffic || !this.ambience) return;
    this.traffic.frequency.setTargetAtTime(220 + busyness * 520, this.context.currentTime, 0.3);
    this.ambience.gain.setTargetAtTime(this.settings.ambienceVolume * (0.12 + busyness * 0.45), this.context.currentTime, 0.3);
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

  private burst(out: AudioNode, at: number, length: number, volume: number, type: BiquadFilterType, frequency: number) {
    const context = this.context!;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * length), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / data.length) ** 2;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(at);
  }

  /** Notes and coins: a till's bright double ping over the rustle of paper money. */
  cash() {
    if (!this.context || !this.effects) return;
    const at = this.context.currentTime + 0.01;
    this.tone(this.effects, "sine", 1_975, 1_970, at, 0.18, 0.12);
    this.tone(this.effects, "sine", 2_637, 2_630, at + 0.09, 0.35, 0.1);
    this.tone(this.effects, "triangle", 3_950, 3_900, at + 0.09, 0.12, 0.03);
    for (let i = 0; i < 4; i++) this.burst(this.effects, at + 0.05 + i * 0.07, 0.06, 0.12, "bandpass", 3_200);
  }

  /** A hit in the car: a body thump scaled by how hard, the crumple of panels and, when it's bad, glass. */
  crash(strength: number) {
    if (!this.context || !this.effects) return;
    const hard = Math.max(0.2, Math.min(1, strength));
    const at = this.context.currentTime + 0.005;
    this.tone(this.effects, "sine", 110, 38, at, 0.35, 0.9 * hard);
    this.burst(this.effects, at, 0.28, 0.7 * hard, "lowpass", 900);
    this.burst(this.effects, at + 0.02, 0.18, 0.3 * hard, "bandpass", 2_200);
    if (hard > 0.6) for (let i = 0; i < 5; i++) this.tone(this.effects, "triangle", 3_000 + Math.random() * 2_500, 2_500, at + 0.08 + i * 0.04, 0.09, 0.05);
  }

  /**
   * The engine of whatever the player drives, pitched by road speed and growling louder on the throttle; null when
   * they're out of the car (or on a bicycle).
   */
  setEngine(engine: { speed: number; throttle: number; bike: boolean } | null) {
    const context = this.context;
    if (!context || !this.effects) return;
    if (!engine) {
      if (this.motor) {
        const { low, high, gain } = this.motor;
        gain.gain.setTargetAtTime(0, context.currentTime, 0.15);
        setTimeout(() => {
          low.stop();
          high.stop();
          gain.disconnect();
        }, 900);
        this.motor = null;
      }
      return;
    }
    if (!this.motor) {
      const low = context.createOscillator();
      const high = context.createOscillator();
      low.type = "sawtooth";
      high.type = "square";
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 500;
      filter.Q.value = 2;
      const gain = context.createGain();
      gain.gain.value = 0;
      low.connect(filter);
      high.connect(filter);
      filter.connect(gain);
      gain.connect(this.effects);
      low.start();
      high.start();
      this.motor = { low, high, filter, gain };
    }
    const { low, high, filter, gain } = this.motor;
    const now = context.currentTime;
    // A gear change every quarter of top speed: revs climb through each gear and drop back at the shift.
    const gear = Math.min(0.999, engine.speed) * 4;
    const revs = 0.25 + (gear - Math.floor(gear)) * 0.55 + Math.floor(gear) * 0.05 + engine.throttle * 0.1;
    const base = (engine.bike ? 70 : 38) + revs * (engine.bike ? 120 : 70);
    low.frequency.setTargetAtTime(base, now, 0.08);
    high.frequency.setTargetAtTime(base * 2.01, now, 0.08);
    filter.frequency.setTargetAtTime(380 + revs * 900 + engine.throttle * 500, now, 0.1);
    gain.gain.setTargetAtTime((0.05 + engine.throttle * 0.07 + Math.min(1, engine.speed) * 0.04) * (0.6 + this.settings.ambienceVolume * 0.6), now, 0.1);
  }

  /** Footfalls in time with the stride; softer and duller indoors. */
  footsteps(speed: number, dt: number, indoors: boolean) {
    if (!this.context || !this.effects || speed < 0.3) {
      this.stride = 0;
      return;
    }
    // About two steps a second walking, three and a half running.
    this.stride += dt * (1.2 + speed * 0.42);
    if (this.stride < 1) return;
    this.stride -= 1;
    const at = this.context.currentTime + 0.005;
    const volume = Math.min(0.32, 0.12 + speed * 0.03);
    this.burst(this.effects, at, 0.07, volume, "lowpass", indoors ? 520 : 900 + Math.random() * 300);
    this.tone(this.effects, "sine", 90, 60, at, 0.05, volume * 0.6);
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
    for (const type of ["pointerdown", "touchend", "click", "keydown"]) window.removeEventListener(type, this.gesture);
    document.removeEventListener("click", this.tapped, { capture: true });
    document.removeEventListener("visibilitychange", this.visibility);
    this.setEngine(null);
    if (this.clubTimer) clearInterval(this.clubTimer);
    this.clubTimer = null;
    this.club = null;
    void this.context?.close();
  }
}
