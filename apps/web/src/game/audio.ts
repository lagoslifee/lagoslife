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

  constructor(settings: PlayerSettings) {
    this.settings = settings;
    const unlock = () => {
      this.start();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

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
  }

  apply(settings: PlayerSettings) {
    this.settings = settings;
    if (!this.master || !this.ambience) return;
    this.master.gain.value = settings.masterVolume;
    this.ambience.gain.value = settings.ambienceVolume * 0.5;
  }

  /** Called each frame with how busy the surroundings are (0 indoors, 1 on Admiralty Way). */
  update(now: number, busyness: number) {
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

  announce(text: string) {
    if (!("speechSynthesis" in window) || this.settings.dialogueVolume <= 0) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = this.settings.dialogueVolume * this.settings.masterVolume;
    utterance.rate = 1.05;
    const voice = speechSynthesis.getVoices().find((candidate) => candidate.lang === "en-NG") ?? speechSynthesis.getVoices().find((candidate) => candidate.lang.startsWith("en"));
    if (voice) utterance.voice = voice;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  dispose() {
    void this.context?.close();
  }
}
