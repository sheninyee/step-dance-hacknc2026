import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, setupForPage } from '../server.mjs';
import { GeminiCoach } from '../js/gemini-coach.js';
import { createMicMeter, coachEnabled, rememberCoach } from '../js/voice-ui.js';
import { mountPageCoach, createPageActions } from '../js/page-coach.js';

function fakePage() {
  class Element {
    constructor(text = '', tagName = '') { this.textContent = text; this.tagName = tagName; this.children = []; this.events = {}; this.attributes = {}; this.dataset = {}; this.style = {}; }
    append(...children) { this.children.push(...children); }
    after() {}
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, fn) { this.events[name] = fn; }
    click() { this.events.click?.(); }
    querySelector(selector) { this.parts ||= {}; return this.parts[selector] ||= new Element(); }
    set innerHTML(_) { this.parts = {}; }
  }
  const panel = new Element();
  const selectors = { '.home-coach-panel': panel, '.logo-text': new Element('STEP DANCE'), '.subheading': new Element('Your premier site for dance practice with audio feedback and instructions!') };
  const doc = { body: new Element(), getElementById: () => null,
    querySelector: selector => selectors[selector], createElement: tag => new Element('', tag),
    querySelectorAll: selector => selector === '.nav-links a' ? ['songlist', 'learn', 'settings'].map(text => new Element(text)) : [] };
  const events = {}, spoken = [], store = new Map();
  const surface = { location: {}, setTimeout, addEventListener(name, fn) { (events[name] ||= new Set()).add(fn); }, removeEventListener(name, fn) { events[name]?.delete(fn); },
    sessionStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, speechSynthesis: { speak: utterance => spoken.push(utterance), cancel() {} } };
  return { doc, surface, spoken, panel, events };
}

test('homepage automatically starts one Gemini conversation, reads page text, and has no voice buttons', () => {
  const { doc, surface, spoken, panel, events } = fakePage();
  const sessions = [];
  let resumes = 0;
  class Coach { constructor(options) { this.options = options; sessions.push(this); } start() {} stop() { this.options.onStopped(); } resumeAudio() { resumes++; } }
  const controller = mountPageCoach('home', { doc, surface, Coach });
  assert.equal(sessions.length, 1);
  assert.equal(spoken.length, 0, 'Gemini, rather than browser synthesis, reads the homepage');
  assert.equal(panel.children.some(child => child.tagName === 'button'), false);
  assert.equal(sessions[0].options.page, 'home');
  assert.match(sessions[0].options.openingPrompt, /STEP DANCE.*Your premier site.*songlist, learn, settings.*Ready/);
  assert.match(sessions[0].options.openingPrompt, /microphone is already listening/);
  assert.doesNotMatch(sessions[0].options.openingPrompt, /Press space bar to start/);
  assert.equal(surface.location.href, undefined, 'Auto-start stays on Home to allow a conversation');
  assert.equal(coachEnabled(surface), true);
  for (const fn of events.keydown) fn({ code: 'Space', target: {}, preventDefault() {} });
  assert.equal(sessions.length, 1, 'Unlocking audio must not open another mic session');
  assert.equal(resumes, 1);
  sessions[0].options.onLevel(.08, false, true);
  const wave = doc.body.children.find(el => el.id === 'voice-wave');
  assert.equal(wave.hidden, false);
  assert.equal(wave.querySelector('.wave-label').textContent, 'YOU SPEAKING');
  sessions[0].options.onAction('pause_coach').deferred();
  assert.equal(coachEnabled(surface), false);
  assert.equal(wave.hidden, true);
  controller.stop();
});

test('auto-start requests the microphone before waiting for suspended playback and cleans up late permission', async t => {
  const events = new Map();
  let requestMic, requests = 0, stopped = 0;
  class AudioContext {
    state = 'suspended';
    resume() { return new Promise(() => {}); }
    async close() { this.state = 'closed'; }
  }
  const replacements = {
    window: { AudioContext, AudioWorkletNode: class {}, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) },
    AudioContext,
    navigator: { mediaDevices: { getUserMedia: () => { requests++; return new Promise(resolve => { requestMic = resolve; }); } } },
    cancelAnimationFrame() {}
  };
  for (const [name, value] of Object.entries(replacements)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  const coach = new GeminiCoach({ onStatus() {}, onStopped() {}, onTranscript() {}, onLevel() {}, onAction() {} });
  const starting = coach.start();
  assert.equal(requests, 1, 'Mic permission must be requested even when resume() has not resolved');
  assert.equal(events.size, 2, 'Page gestures can unlock playback without a Start button');
  coach.stop();
  requestMic({ getTracks: () => [{ stop() { stopped++; } }] });
  await starting;
  assert.equal(stopped, 1, 'Permission granted after leaving the page must release the mic');
  assert.equal(events.size, 0, 'Stopping removes audio unlock handlers');
});

test('microphone meter follows measured sound, connection readiness, and coach speech', () => {
  const { doc } = fakePage();
  const element = doc.createElement('aside');
  const meter = createMicMeter(element, doc);
  meter.update(0, false, false);
  assert.equal(element.querySelector('.wave-label').textContent, 'CONNECTING');
  meter.update(.1, false, true);
  assert.equal(element.querySelector('.wave-label').textContent, 'YOU SPEAKING');
  assert.ok(element.querySelector('.wave-bars').children.some(bar => parseFloat(bar.style.height) > 5));
  meter.update(0, true, true);
  assert.equal(element.querySelector('.wave-label').textContent, 'COACH SPEAKING');
  meter.update(0, false, true);
  assert.equal(element.querySelector('.wave-label').textContent, 'MIC LIVE');
  meter.hide(); assert.equal(element.hidden, true);
});

test('page actions navigate only to known pages and retain opt-in across navigation', () => {
  const { doc, surface } = fakePage();
  rememberCoach(true, surface);
  const stopCalls = [];
  const actions = createPageActions({ page: 'home', doc, surface, stop: forget => { stopCalls.push(forget); if (forget) rememberCoach(false, surface); } });
  assert.match(actions('navigate_page', { page: 'https://example.com' }).error, /Choose/);
  const go = actions('navigate_page', { page: 'songs' });
  assert.equal(surface.location.href, undefined);
  go.deferred();
  assert.equal(surface.location.href, 'songs.html?startCoach=1');
  assert.equal(coachEnabled(surface), true);
  assert.deepEqual(stopCalls, [false]);
  actions('pause_coach').deferred();
  assert.equal(coachEnabled(surface), false);
  assert.match(actions('read_page').text, /STEP DANCE/);
  assert.match(actions('start_recording').error, /not available/);
});

test('Live uses the current page introduction and listening message', () => {
  const sent = [], statuses = [];
  const coach = new GeminiCoach({ page: 'home', openingPrompt: 'Read the homepage text first.', listeningMessage: 'Listening on Home.', onStatus: value => statuses.push(value), onStopped() {}, onTranscript() {}, onLevel() {}, onAction() {} });
  coach.send = value => sent.push(value);
  coach.handleMessage({ setupComplete: {} });
  assert.equal(sent[0].clientContent.turns[0].parts[0].text, 'Read the homepage text first.');
  coach.handleMessage({ serverContent: { turnComplete: true } });
  assert.equal(statuses.at(-1), 'Listening on Home.');
});

test('Pause pauses every music track in place, cancels autoplay, and keeps the coach active', () => {
  const tracks = [12, 35].map(currentTime => {
    const track = new EventTarget();
    Object.assign(track, { currentTime, paused: false, autoplay: true, autoplayPending: true });
    track.pause = () => { track.paused = true; };
    track.addEventListener('step-dance:pause-music', () => { track.autoplayPending = false; });
    return track;
  });
  const doc = { querySelectorAll: selector => selector === 'audio' ? tracks : [], defaultView: { Event } };
  let coachStops = 0;
  const actions = createPageActions({ page: 'practice', doc, surface: {}, stop: () => { coachStops++; } });
  const result = actions('pause_music');
  assert.equal(result.musicPaused, true);
  assert.equal(result.pausedPlayers, 2);
  assert.deepEqual(tracks.map(track => track.currentTime), [12, 35]);
  assert.ok(tracks.every(track => track.paused && !track.autoplay && !track.autoplayPending));
  assert.equal(coachStops, 0);
});

test('server issues page-specific Live setup and rejects unknown page context', async t => {
  const server = createServer({ apiKey: 'test-key', fetchToken: async () => ({ ok: true, json: async () => ({ name: 'temporary-token' }) }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const page of ['home', 'songs', 'practice', 'settings']) {
    const response = await fetch(base + '/api/gemini-session', { method: 'POST', headers: { Origin: base, 'X-Step-Dance': 'voice-coach', 'X-Step-Dance-Page': page } });
    assert.equal(response.status, 200);
    const { setup } = await response.json();
    const tools = setup.tools[0].functionDeclarations.map(tool => tool.name);
    assert.ok(tools.includes('navigate_page'));
    assert.ok(tools.includes('pause_music'), 'Pause is available on every page');
    assert.equal(tools.includes('select_song'), page === 'songs');
    assert.equal(tools.includes('start_recording'), page === 'practice');
    assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
  }
  const response = await fetch(base + '/api/gemini-session', { method: 'POST', headers: { Origin: base, 'X-Step-Dance': 'voice-coach', 'X-Step-Dance-Page': 'unknown' } });
  assert.equal(response.status, 400);
  assert.throws(() => setupForPage('unknown'));
});
