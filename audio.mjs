const SPEECH_VOLUME = 0.65;
const MAX_VOICES = 2;

/** Gesture-unlocked audio with synchronous HTMLAudio playback while buffers load. */
export class PilotAudio {
  constructor({ muted = false, onMuteChange = () => {} } = {}) {
    this.muted = Boolean(muted);
    this.context = null;
    this.master = null;
    this._onMuteChange = onMuteChange;
    this._generation = 0;
    this._clips = [];
    this._voices = [];
    this._tones = new Set();
    this._flapIndex = 0;
  }

  setPilot({ id, voices = [] } = {}) {
    this.silence();
    for (const clip of this._clips) clip.controller?.abort();
    this._generation += 1;
    this._pilotId = id;
    this._flapIndex = 0;
    this._clips = voices.filter((voice) => voice && typeof voice.src === 'string' && voice.src)
      .map((voice) => this._makeClip(voice));
    for (const clip of this._clips) {
      this._prefetch(clip);
      if (this.context) this._decode(clip);
    }
  }

  _makeClip({ src, fallback }) {
    const pool = [];
    let preferred = src;
    if (typeof globalThis.Audio === 'function') {
      const first = new globalThis.Audio();
      if (fallback && /\.og[ga](?:$|[?#])/i.test(src)
        && typeof first.canPlayType === 'function' && !first.canPlayType('audio/ogg')) preferred = fallback;
      for (let i = 0; i < 3; i += 1) {
        const audio = i === 0 ? first : new globalThis.Audio();
        audio.src = preferred;
        audio.preload = 'auto';
        audio.volume = SPEECH_VOLUME;
        pool.push({ audio, voice: null });
      }
    }
    return {
      generation: this._generation,
      src,
      fallback: typeof fallback === 'string' ? fallback : null,
      preferred,
      pool,
      poolIndex: 0,
      buffer: null,
      decoding: false,
      failed: new Set(),
      requests: new Map(),
      controller: typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null,
    };
  }

  _current(clip) {
    return clip.generation === this._generation && this._clips.includes(clip);
  }

  _urls(clip) {
    return [...new Set([clip.preferred, clip.fallback].filter((url) => url && !clip.failed.has(url)))];
  }

  _bytes(clip, url) {
    if (!clip.requests.has(url)) {
      const request = globalThis.fetch(url, clip.controller ? { signal: clip.controller.signal } : undefined)
        .then((response) => {
          if (!response.ok) throw new Error('Audio unavailable');
          return response.arrayBuffer();
        });
      clip.requests.set(url, request);
    }
    return clip.requests.get(url);
  }

  async _prefetch(clip) {
    for (const url of this._urls(clip)) {
      try {
        await this._bytes(clip, url);
        if (this._current(clip) && !clip.failed.has(url)) this._prefer(clip, url);
        return;
      } catch {
        if (!this._current(clip)) return;
        clip.failed.add(url);
      }
    }
  }

  _prefer(clip, url) {
    clip.preferred = url;
    for (const entry of clip.pool) if (!entry.voice && entry.audio.src !== url) entry.audio.src = url;
  }

  async _decode(clip) {
    if (!this.context || clip.buffer || clip.decoding || !this._current(clip)) return;
    clip.decoding = true;
    const context = this.context;
    try {
      for (const url of this._urls(clip)) {
        try {
          const bytes = await this._bytes(clip, url);
          if (!this._current(clip) || context !== this.context) return;
          const buffer = await context.decodeAudioData(bytes.slice(0));
          if (!this._current(clip) || context !== this.context) return;
          clip.buffer = buffer;
          this._prefer(clip, url);
          return;
        } catch {
          if (!this._current(clip)) return;
          clip.failed.add(url);
        }
      }
    } finally {
      clip.decoding = false;
    }
  }

  /** Call from a click, tap, or keyboard gesture; never from preload or a timer. */
  unlock() {
    try {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!this.context && AudioContext) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : SPEECH_VOLUME;
        this.master.connect(this.context.destination);
      }
      if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
      for (const clip of this._clips) this._decode(clip);
    } catch { /* HTMLAudio remains available if Web Audio cannot initialize. */ }
  }

  playFlap() {
    if (this.muted || !this._clips.length) return;
    this.unlock();
    const clip = this._clips[this._flapIndex++ % this._clips.length];
    this._play(clip);
  }

  playDefeat() {
    this.silence();
    if (!this.muted) this._play(this._clips[1] || this._clips[0]);
  }

  _play(clip) {
    if (!clip || !this._current(clip) || this.muted) return;
    while (this._voices.length >= MAX_VOICES) this._finish(this._voices[0], true);
    if (this.context?.state === 'running' && clip.buffer) {
      let voice;
      try {
        const source = this.context.createBufferSource();
        const gain = this.context.createGain();
        source.buffer = clip.buffer;
        source.connect(gain);
        gain.connect(this.master);
        voice = { kind: 'buffer', source, gain, done: false };
        this._voices.push(voice);
        source.onended = () => this._finish(voice);
        source.start();
        return;
      } catch {
        if (voice) this._finish(voice, true);
        // Fall back to the prepared HTMLAudio pool.
      }
    }
    if (!clip.pool.length) return;
    const entry = clip.pool[clip.poolIndex++ % clip.pool.length];
    if (entry.voice) this._finish(entry.voice, true);
    const voice = { kind: 'html', entry, clip, done: false, tried: new Set(), attempt: 0 };
    entry.voice = voice;
    this._voices.push(voice);
    entry.audio.onended = () => this._finish(voice);
    // No await: first-gesture playback must stay in the original gesture stack.
    this._startHTML(voice, clip.preferred);
  }

  _startHTML(voice, url) {
    if (voice.done || this.muted || !this._current(voice.clip)) return;
    const { audio } = voice.entry;
    const attempt = ++voice.attempt;
    voice.url = url;
    voice.tried.add(url);
    audio.onerror = () => this._retryHTML(voice, attempt);
    try {
      if (audio.src !== url) audio.src = url;
      audio.currentTime = 0;
      const playback = audio.play();
      playback?.catch((error) => {
        if (voice.done || voice.attempt !== attempt) return;
        if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') this._finish(voice, true);
        else this._retryHTML(voice, attempt);
      });
    } catch {
      this._retryHTML(voice, attempt);
    }
  }

  _retryHTML(voice, attempt = voice.attempt) {
    if (voice.done || voice.attempt !== attempt || !this._current(voice.clip)) return;
    voice.clip.failed.add(voice.url);
    const fallback = voice.clip.fallback;
    if (!this.muted && fallback && !voice.tried.has(fallback)) {
      this._prefer(voice.clip, fallback);
      this._startHTML(voice, fallback);
    } else this._finish(voice, true);
  }

  _finish(voice, stop = false) {
    if (voice.done) return;
    voice.done = true;
    this._voices = this._voices.filter((item) => item !== voice);
    if (voice.kind === 'buffer') {
      voice.source.onended = null;
      if (stop) { try { voice.source.stop(); } catch {} }
      voice.source.disconnect();
      voice.gain.disconnect();
    } else if (voice.entry.voice === voice) {
      const { audio } = voice.entry;
      audio.onended = null;
      audio.onerror = null;
      if (stop) {
        audio.pause();
        try { audio.currentTime = 0; } catch {}
      }
      voice.entry.voice = null;
    }
  }

  chime(record = false) {
    if (this.muted || this.context?.state !== 'running') return;
    const at = this.context.currentTime;
    (record ? [523.25, 659.25, 783.99] : [659.25, 880]).forEach((frequency, i) => {
      const source = this.context.createOscillator();
      const gain = this.context.createGain();
      source.type = 'sine';
      source.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at + i * 0.08);
      gain.gain.linearRampToValueAtTime(0.12, at + i * 0.08 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, at + i * 0.08 + 0.24);
      source.connect(gain);
      gain.connect(this.master);
      const tone = { source, gain };
      this._tones.add(tone);
      source.onended = () => {
        this._tones.delete(tone);
        source.disconnect();
        gain.disconnect();
      };
      source.start(at + i * 0.08);
      source.stop(at + i * 0.08 + 0.25);
    });
  }

  silence() {
    for (const voice of [...this._voices]) this._finish(voice, true);
    for (const tone of this._tones) {
      tone.source.onended = null;
      try { tone.source.stop(); } catch {}
      tone.source.disconnect();
      tone.gain.disconnect();
    }
    this._tones.clear();
  }

  toggle() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : SPEECH_VOLUME;
    if (this.muted) this.silence();
    this._onMuteChange(this.muted);
    return this.muted;
  }
}
