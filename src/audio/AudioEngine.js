import { readStorage, writeStorage } from "../utils/storage.js";
import {
  AUDIO_STORAGE_KEY,
  DEFAULT_AUDIO_PREFS,
  SOUND_IDS,
  normalizeAudioPrefs,
} from "./constants.js";
import { buildSoundBank } from "./synth.js";

/**
 * Offline Web Audio engine — preloaded buffers, master gain, mute, ambient.
 */
export class AudioEngine {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {GainNode|null} */
    this.master = null;
    /** @type {GainNode|null} */
    this.ambientGain = null;
    /** @type {AudioBufferSourceNode|null} */
    this.ambientSource = null;
    /** @type {Record<string, AudioBuffer>} */
    this.buffers = {};
    this.ready = false;
    this.unlocked = false;
    this.prefs = this.#readPrefs();
  }

  #readPrefs() {
    try {
      const raw = readStorage(AUDIO_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_AUDIO_PREFS };
      return normalizeAudioPrefs(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_AUDIO_PREFS };
    }
  }

  #persist() {
    writeStorage(AUDIO_STORAGE_KEY, JSON.stringify(this.prefs));
  }

  #ensureGraph() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.#applyGain();
    return this.ctx;
  }

  #applyGain() {
    if (!this.master || !this.ctx) return;
    const now = this.ctx.currentTime;
    const level = this.prefs.muted ? 0 : this.prefs.volume;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(level, now, 0.02);
    if (this.ambientGain) {
      const amb = this.prefs.ambient && !this.prefs.muted ? 0.22 : 0;
      this.ambientGain.gain.cancelScheduledValues(now);
      this.ambientGain.gain.setTargetAtTime(amb, now, 0.05);
    }
  }

  /**
   * Unlock audio on a user gesture, then preload all buffers.
   * @returns {Promise<boolean>}
   */
  async unlock() {
    const ctx = this.#ensureGraph();
    if (!ctx) return false;
    try {
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      this.unlocked = true;
      await this.preload();
      if (this.prefs.ambient) this.startAmbient();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Bake procedural sounds into reusable AudioBuffers.
   * @returns {Promise<void>}
   */
  async preload() {
    const ctx = this.#ensureGraph();
    if (!ctx || this.ready) return;
    this.buffers = buildSoundBank(ctx);
    this.ready = true;
  }

  getPrefs() {
    return { ...this.prefs };
  }

  /**
   * @param {number} volume 0..1
   */
  setVolume(volume) {
    this.prefs = normalizeAudioPrefs({ ...this.prefs, volume });
    this.#persist();
    this.#applyGain();
  }

  /**
   * @param {boolean} muted
   */
  setMuted(muted) {
    this.prefs = normalizeAudioPrefs({ ...this.prefs, muted: Boolean(muted) });
    this.#persist();
    this.#applyGain();
    if (this.prefs.muted) this.stopAmbient();
    else if (this.prefs.ambient) this.startAmbient();
  }

  toggleMute() {
    this.setMuted(!this.prefs.muted);
    return this.prefs.muted;
  }

  /**
   * @param {boolean} enabled
   */
  setAmbient(enabled) {
    this.prefs = normalizeAudioPrefs({ ...this.prefs, ambient: Boolean(enabled) });
    this.#persist();
    this.#applyGain();
    if (this.prefs.ambient && !this.prefs.muted) this.startAmbient();
    else this.stopAmbient();
  }

  /**
   * @param {string} id
   * @param {{ gain?: number }} [options]
   */
  play(id, options = {}) {
    if (!SOUND_IDS.includes(id)) return;
    if (this.prefs.muted && id !== "ambient") return;
    const ctx = this.#ensureGraph();
    if (!ctx || !this.unlocked) return;
    if (!this.ready) {
      this.preload();
    }
    const buffer = this.buffers[id];
    if (!buffer || !this.master) return;

    try {
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      const local = options.gain ?? 1;
      gain.gain.value = Math.max(0, Math.min(1.5, local));
      source.connect(gain);
      gain.connect(this.master);
      source.start(0);
    } catch {
      // Ignore playback failures (autoplay / closed context).
    }
  }

  startAmbient() {
    if (!this.prefs.ambient || this.prefs.muted) return;
    const ctx = this.#ensureGraph();
    if (!ctx || !this.unlocked || !this.ready || !this.ambientGain) return;
    if (this.ambientSource) return;
    const buffer = this.buffers.ambient;
    if (!buffer) return;
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this.ambientGain);
      source.start(0);
      this.ambientSource = source;
      this.#applyGain();
    } catch {
      this.ambientSource = null;
    }
  }

  stopAmbient() {
    if (!this.ambientSource) return;
    try {
      this.ambientSource.stop();
    } catch {
      // already stopped
    }
    this.ambientSource = null;
  }
}

/** Shared singleton for the app session. */
export const audioEngine = new AudioEngine();
