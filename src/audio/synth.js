/**
 * Offline procedural sound bank — soft, realistic table tones (no arcade sting).
 * Renders into AudioBuffers once for low-latency playback.
 */

/**
 * @param {AudioContext} ctx
 * @param {number} durationSec
 * @param {(t: number, i: number, data: Float32Array) => number} fn
 * @returns {AudioBuffer}
 */
function renderBuffer(ctx, durationSec, fn) {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    data[i] = fn(t, i, data);
  }
  return buffer;
}

function clamp(value, min = -1, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function envelope(t, attack, decay, sustain = 0) {
  if (t < attack) return t / Math.max(attack, 0.0001);
  const d = t - attack;
  if (d < decay) return 1 - (1 - sustain) * (d / Math.max(decay, 0.0001));
  return sustain * Math.exp(-(t - attack - decay) * 8);
}

function noiseSample(i) {
  // Deterministic soft noise (no Math.random in buffer bake for stability).
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * @param {AudioContext} ctx
 * @returns {Record<string, AudioBuffer>}
 */
export function buildSoundBank(ctx) {
  /** @type {Record<string, AudioBuffer>} */
  const bank = {};

  // Domino click — short ivory-on-felt tap when a tile lands.
  bank.place = renderBuffer(ctx, 0.14, (t, i) => {
    const body =
      Math.sin(2 * Math.PI * (185 - t * 110) * t) * envelope(t, 0.002, 0.055) * 0.42;
    const click = noiseSample(i) * Math.exp(-t * 140) * 0.38;
    const tip =
      Math.sin(2 * Math.PI * 920 * t) * Math.exp(-t * 90) * 0.08;
    return clamp((body + click + tip) * 0.72);
  });

  // Pickup — light lift click.
  bank.pickup = renderBuffer(ctx, 0.1, (t, i) => {
    const click = noiseSample(i) * Math.exp(-t * 90) * 0.35;
    const tone = Math.sin(2 * Math.PI * 520 * t) * Math.exp(-t * 40) * 0.12;
    return clamp(click + tone);
  });

  // Draw from reserve — soft scrape.
  bank.draw = renderBuffer(ctx, 0.28, (t, i) => {
    const scrape = noiseSample(i) * (0.15 + 0.1 * Math.sin(t * 40)) * Math.exp(-t * 9) * 0.55;
    const body = Math.sin(2 * Math.PI * (210 - t * 40) * t) * envelope(t, 0.01, 0.18) * 0.25;
    return clamp(scrape + body);
  });

  // UI button — tiny tick.
  bank.button = renderBuffer(ctx, 0.06, (t, i) => {
    const n = noiseSample(i) * Math.exp(-t * 120) * 0.28;
    const p = Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 70) * 0.1;
    return clamp(n + p);
  });

  bank.menuOpen = renderBuffer(ctx, 0.16, (t) => {
    const a = Math.sin(2 * Math.PI * 320 * t) * Math.exp(-t * 18) * 0.14;
    const b = Math.sin(2 * Math.PI * 480 * t) * Math.exp(-t * 22) * 0.1;
    return clamp((a + b) * envelope(t, 0.01, 0.12));
  });

  bank.menuClose = renderBuffer(ctx, 0.14, (t) => {
    const a = Math.sin(2 * Math.PI * 420 * t) * Math.exp(-t * 24) * 0.12;
    const b = Math.sin(2 * Math.PI * 260 * t) * Math.exp(-t * 20) * 0.1;
    return clamp((a + b) * envelope(t, 0.008, 0.1));
  });

  // AI land — same click family, slightly softer.
  bank.aiMove = renderBuffer(ctx, 0.13, (t, i) => {
    const body =
      Math.sin(2 * Math.PI * (175 - t * 100) * t) * envelope(t, 0.002, 0.05) * 0.36;
    const click = noiseSample(i) * Math.exp(-t * 145) * 0.3;
    return clamp((body + click) * 0.62);
  });

  // Turn notice — soft two-tone chime.
  bank.turn = renderBuffer(ctx, 0.32, (t) => {
    const a = Math.sin(2 * Math.PI * 523.25 * t) * Math.exp(-t * 6) * 0.12;
    const b = Math.sin(2 * Math.PI * 659.25 * t) * Math.exp(-Math.max(0, t - 0.06) * 7) * (t > 0.05 ? 0.1 : 0);
    return clamp((a + b) * 0.85);
  });

  bank.roundWin = renderBuffer(ctx, 0.55, (t) => {
    const notes = [523.25, 659.25, 783.99];
    let sample = 0;
    for (let n = 0; n < notes.length; n += 1) {
      const start = n * 0.09;
      if (t < start) continue;
      const local = t - start;
      sample += Math.sin(2 * Math.PI * notes[n] * local) * Math.exp(-local * 5) * 0.1;
    }
    return clamp(sample);
  });

  bank.matchWin = renderBuffer(ctx, 1.15, (t) => {
    const notes = [392, 523.25, 659.25, 783.99, 1046.5];
    let sample = 0;
    for (let n = 0; n < notes.length; n += 1) {
      const start = n * 0.1;
      if (t < start) continue;
      const local = t - start;
      sample += Math.sin(2 * Math.PI * notes[n] * local) * Math.exp(-local * 3.8) * 0.12;
    }
    const shimmer =
      Math.sin(2 * Math.PI * 1568 * t) * Math.exp(-t * 5) * 0.04 * (t > 0.35 ? 1 : 0);
    return clamp(sample + shimmer);
  });

  bank.defeat = renderBuffer(ctx, 0.75, (t) => {
    const a = Math.sin(2 * Math.PI * (220 - t * 70) * t) * Math.exp(-t * 2.8) * 0.15;
    const b = Math.sin(2 * Math.PI * (165 - t * 45) * t) * Math.exp(-t * 3.4) * 0.11;
    const c = Math.sin(2 * Math.PI * (110 - t * 20) * t) * Math.exp(-t * 2.2) * 0.06;
    return clamp(a + b + c);
  });

  bank.error = renderBuffer(ctx, 0.16, (t, i) => {
    const buzz = Math.sin(2 * Math.PI * 160 * t) * Math.exp(-t * 14) * 0.12;
    const n = noiseSample(i) * Math.exp(-t * 30) * 0.08;
    return clamp(buzz + n);
  });

  // Subtle ambient bed (loop-friendly soft noise).
  bank.ambient = renderBuffer(ctx, 2.4, (t, i) => {
    const n1 = noiseSample(i) * 0.04;
    const n2 = noiseSample(i + 97) * 0.03;
    const hum = Math.sin(2 * Math.PI * 62 * t) * 0.015;
    const swell = 0.55 + 0.45 * Math.sin(2 * Math.PI * (t / 2.4));
    return clamp((n1 + n2 + hum) * swell * 0.55);
  });

  return bank;
}
