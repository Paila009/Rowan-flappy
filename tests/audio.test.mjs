import test from 'node:test';
import assert from 'node:assert/strict';
import { PilotAudio } from '../audio.mjs';

const defer = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

async function withAudioEnvironment(callback, { deferredDecode = false } = {}) {
  const originals = Object.fromEntries(['Audio', 'AudioContext', 'webkitAudioContext', 'fetch'].map((key) => [key, globalThis[key]]));
  const played = [];
  const decoded = [];
  const started = [];
  const contexts = [];
  const node = () => ({
    gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect() {}, disconnect() {},
  });
  class FakeAudio {
    constructor() { this.src = ''; this.currentTime = 0; this.paused = true; }
    canPlayType() { return 'probably'; }
    play() { this.paused = false; played.push({ src: this.src, audio: this }); return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  class FakeContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; contexts.push(this); }
    createGain() { return node(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    decodeAudioData(bytes) {
      const pending = defer();
      const request = { url: new TextDecoder().decode(bytes), ...pending };
      decoded.push(request);
      if (!deferredDecode) pending.resolve({ url: request.url });
      return pending.promise;
    }
    createBufferSource() {
      const source = { ...node(), start() { started.push(source.buffer); }, stop() { source.onended?.(); } };
      return source;
    }
  }
  globalThis.Audio = FakeAudio;
  globalThis.AudioContext = FakeContext;
  globalThis.webkitAudioContext = undefined;
  globalThis.fetch = async (url) => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer });
  try { await callback({ played, decoded, started, contexts }); }
  finally {
    await flush();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

test('preload does not unlock audio; initial flaps play synchronously and alternate', async () => {
  await withAudioEnvironment(async ({ played, contexts }) => {
    const audio = new PilotAudio();
    audio.setPilot({ id: 'specs', voices: [{ src: 'one.ogg' }, { src: 'two.ogg' }] });
    assert.equal(contexts.length, 0);
    audio.playFlap();
    assert.equal(played.length, 1);
    assert.equal(played[0].src, 'one.ogg');
    audio.playFlap();
    audio.playFlap();
    assert.deepEqual(played.map((play) => play.src), ['one.ogg', 'two.ogg', 'one.ogg']);
    assert.equal(played[0].audio.paused, true);
    assert.equal(audio._voices.length, 2);
    audio.silence();
    assert.ok(played.every((play) => play.audio.paused));
  });
});

test('pilot switching rejects stale decodes and resets the voice sequence', async () => {
  await withAudioEnvironment(async ({ played, decoded, started }) => {
    const audio = new PilotAudio();
    audio.setPilot({ id: 'old', voices: [{ src: 'old.ogg' }] });
    audio.playFlap();
    await flush();
    const oldDecode = decoded.find((request) => request.url === 'old.ogg');
    assert.ok(oldDecode);
    audio.setPilot({ id: 'new', voices: [{ src: 'new-one.ogg' }, { src: 'new-two.ogg' }] });
    assert.equal(played[0].audio.paused, true);
    await flush();
    oldDecode.resolve({ url: 'old.ogg' });
    for (const request of decoded.filter((request) => request !== oldDecode)) request.resolve({ url: request.url });
    await flush();
    audio.playFlap();
    audio.playFlap();
    assert.deepEqual(started.map((buffer) => buffer.url), ['new-one.ogg', 'new-two.ogg']);
    audio.silence();
  }, { deferredDecode: true });
});

test('defeat replaces speech with the second full clip and mute stops all speech', async () => {
  await withAudioEnvironment(async ({ played }) => {
    const changes = [];
    const audio = new PilotAudio({ onMuteChange: (muted) => changes.push(muted) });
    audio.setPilot({ id: 'specs', voices: [{ src: 'one.ogg' }, { src: 'two.ogg' }] });
    audio.playFlap();
    audio.playDefeat();
    assert.equal(played[0].audio.paused, true);
    assert.equal(played.at(-1).src, 'two.ogg');
    assert.equal(audio._voices.length, 1);
    assert.equal(played.at(-1).audio.currentTime, 0);
    assert.equal(audio.toggle(), true);
    assert.ok(played.every((play) => play.audio.paused));
    const count = played.length;
    audio.playFlap(); audio.playDefeat();
    assert.equal(played.length, count);
    assert.equal(audio.toggle(), false);
    assert.deepEqual(changes, [true, false]);
  });
});

test('decode failure selects MP3 and old HTML errors cannot stop its retry', async () => {
  await withAudioEnvironment(async ({ played, decoded, started }) => {
    const audio = new PilotAudio();
    audio.setPilot({ id: 'fallback', voices: [{ src: 'voice.ogg', fallback: 'voice.mp3' }] });
    audio.unlock();
    await flush();
    decoded[0].reject(new Error('Unsupported codec'));
    await flush();
    const mp3 = decoded.find((request) => request.url === 'voice.mp3');
    assert.ok(mp3);
    mp3.resolve({ url: 'voice.mp3' });
    await flush();
    audio.playFlap();
    assert.equal(started.at(-1).url, 'voice.mp3');
    audio.silence();

    globalThis.AudioContext = undefined;
    const htmlOnly = new PilotAudio();
    htmlOnly.setPilot({ id: 'fallback', voices: [{ src: 'voice.ogg', fallback: 'voice.mp3' }] });
    htmlOnly.playFlap();
    const first = played.at(-1).audio;
    const staleErrorHandler = first.onerror;
    first.onerror();
    assert.equal(played.at(-1).src, 'voice.mp3');
    staleErrorHandler();
    assert.equal(first.paused, false);
    assert.equal(htmlOnly._voices.length, 1);
    htmlOnly.silence();
  }, { deferredDecode: true });
});
