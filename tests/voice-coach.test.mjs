import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createServer, setup } from '../server.mjs';
import { GeminiCoach, encodePCM, decodePCM } from '../js/gemini-coach.js';
import { SongVolumeDucker } from '../js/song-volume.js';
import { createCoachStartup } from '../js/coach-startup.js';

// Exercise the local HTTP boundary with a mocked Google token response.
test('server protects secrets, requires same origin, and provisions a single-use token', async t => {
  let sent;
  const server = createServer({ apiKey: 'test-secret', fetchToken: async (url, options) => {
    sent = { url, options };
    return { ok: true, json: async () => ({ name: 'short-lived-token' }) };
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/.env', '/server.mjs', '/package.json', '/js/%2eenv', '/js/%2e%2e/.env']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base + '/api/gemini-session', { method: 'POST' })).status, 403);
  const response = await fetch(base + '/api/gemini-session', { method: 'POST', headers: { Origin: base, 'X-Step-Dance': 'voice-coach' } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.token, 'short-lived-token');
  assert.equal(JSON.stringify(body).includes('test-secret'), false);
  assert.equal(JSON.parse(sent.options.body).uses, 1);
  assert.equal(sent.options.headers['x-goog-api-key'], 'test-secret');
  assert.equal(body.setup.generationConfig.responseModalities[0], 'AUDIO');
  assert.equal((await fetch(base + '/songs.html')).status, 200);
});

test('missing API key returns setup instructions', async t => {
  const server = createServer({ apiKey: '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/api/gemini-session', { method: 'POST', headers: { Origin: base, 'X-Step-Dance': 'voice-coach' } });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /GEMINI_API_KEY/);
});

test('PCM conversion preserves signed samples and little-endian byte order', () => {
  const input = new Int16Array([-32768, -1000, 0, 1000, 32767]);
  const encoded = encodePCM(input.buffer);
  assert.equal(Buffer.from(encoded, 'base64').readInt16LE(0), -32768);
  assert.deepEqual([...decodePCM(encoded)], [...input].map(sample => sample / 32768));
  assert.throws(() => decodePCM(btoa('x')), /Invalid/);
});

test('worklet downsamples 48 kHz into continuous 20 ms PCM chunks', async () => {
  let Processor;
  const chunks = [];
  const context = { AudioWorkletProcessor: class { constructor() { this.port = { postMessage: buffer => chunks.push(new Int16Array(buffer)) }; } }, sampleRate: 48000, registerProcessor: (_, cls) => { Processor = cls; } };
  vm.runInNewContext(await readFile(new URL('../js/mic-worklet.js', import.meta.url), 'utf8'), context);
  const processor = new Processor();
  // 30 blocks of 128 samples = 80 ms = four 20 ms output chunks.
  for (let i = 0; i < 30; i++) processor.process([[new Float32Array(128).fill(0.5)]]);
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0].length, 320);
  assert.equal(chunks[0][0], 16384);
});

test('Live messages trigger greeting, transcripts, deduplicated tools, and interruptions', () => {
  const sent = [], actions = [], statuses = [], transcripts = [];
  const coach = new GeminiCoach({ onStatus: text => statuses.push(text), onTranscript: (...args) => transcripts.push(args), onLevel: () => {}, onAction: (name, args) => { actions.push([name, args]); return { ok: true }; }, onStopped: () => {} });
  coach.send = message => sent.push(message);
  coach.handleMessage({ setupComplete: {} });
  assert.match(sent[0].clientContent.turns[0].parts[0].text, /opening question/);
  coach.handleMessage({ serverContent: { inputTranscription: { text: 'Dance!' } } });
  assert.equal(transcripts.at(-1)[0], 'Dance!');
  const call = { id: 'action-1', name: 'dance', args: {} };
  coach.handleMessage({ toolCall: { functionCalls: [call] } });
  coach.handleMessage({ toolCall: { functionCalls: [call] } });
  assert.equal(actions.length, 1);
  let stopped = 0;
  coach.sources.add({ stop: () => stopped++, disconnect: () => {} });
  coach.handleMessage({ serverContent: { interrupted: true, turnComplete: true } });
  assert.equal(stopped, 1);
  assert.equal(coach.sources.size, 0);
  assert.match(statuses.at(-1), /Listening/);
});

test('navigation waits until the spoken response has finished playing', () => {
  let navigated = false;
  const coach = new GeminiCoach({ onStatus: () => {}, onTranscript: () => {}, onLevel: () => {}, onAction: () => ({ deferred: () => { navigated = true; } }), onStopped: () => {} });
  coach.send = () => {};
  coach.handleTools([{ id: 'home-1', name: 'go_home', args: {} }]);
  const source = {};
  coach.sources.add(source);
  coach.handleMessage({ serverContent: { turnComplete: true } });
  assert.equal(navigated, false);
  coach.sources.delete(source);
  coach.finishTurn();
  assert.equal(navigated, true);
});

test('coach stop releases microphone, audio nodes, playback, and socket', () => {
  const released = [];
  const coach = new GeminiCoach({ onStopped: () => released.push('UI') });
  globalThis.cancelAnimationFrame = () => {};
  coach.stream = { getTracks: () => [{ stop: () => released.push('mic') }] };
  coach.socket = { close: () => released.push('socket') };
  coach.context = { close: async () => released.push('context') };
  coach.worklet = { port: {}, disconnect: () => released.push('worklet') };
  coach.stop(); coach.stop();
  assert.deepEqual(released, ['socket', 'worklet', 'mic', 'context', 'UI']);
});

test('song page actions use actual buttons, validate titles, and defer navigation', async () => {
  const elements = new Map();
  class Element {
    constructor() { this.volume=1; this.children=[]; this.events={}; this.dataset={}; this.style={}; this.classes={}; this.classList={ contains:name=>Boolean(this.classes[name]), toggle:(name, active)=>{ this.classes[name]=active; } }; }
    querySelector() { return this.child ||= new Element(); }
    append(el) { this.children.push(el); }
    setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
    getAttribute(name) { return this.attributes?.[name] ?? null; }
    addEventListener(name, fn) { this.events[name]=fn; }
    click() { this.events.click?.(); }
    pause() { this.paused = true; }
    load() {}
    async play() { if (this.playError) throw this.playError; this.paused = false; }
  }
  const rows = ['World Is Mine', 'Shake It Off', 'Tell Your World'].map(title => { const row = new Element(); row.dataset.song=title; row.dataset.preview=`audio/${title.toLowerCase().replaceAll(' ', '_')}.mp3`; return row; });
  rows.forEach((row, index) => row.querySelector().setAttribute('src', ['images/world_is_mine.webp', 'images/shake_it_off.jpeg', 'images/tell_your_world.jpg'][index]));
  rows[0].classList.contains=()=>true;
  const context = { GeminiCoach: class{}, SongVolumeDucker, createCoachStartup, URLSearchParams, document: { querySelectorAll:()=>rows, createElement:()=>new Element(), getElementById:id=>{ if (!elements.has(id)) elements.set(id,new Element()); return elements.get(id); } }, window: { addEventListener:()=>{}, location:{} } };
  vm.createContext(context);
  const code = (await readFile(new URL('../js/songs.js', import.meta.url), 'utf8')).replace(/^import .*\n/gm, '');
  vm.runInContext(code, context);
  assert.equal(vm.runInContext("handleCoachAction('select_song', {title:'Shake It Off'}).selectedSong", context), 'Shake It Off');
  assert.match(vm.runInContext("handleCoachAction('select_song', {title:'unknown'}).error", context), /not on/);
  assert.equal(vm.runInContext("handleCoachAction('dance', {}).dancePageReady", context), false);
  assert.match(elements.get('status').textContent, /Shake It Off selected. Dance mode is not connected/);
  vm.runInContext("handleCoachAction('go_home', {}).deferred()", context);
  assert.equal(context.window.location.href, 'StepDanceHome.html');
  assert.match(setup.systemInstruction.parts[0].text, /Start by saying exactly: "We are on the Song list page\. Would you like me to read the available songs for you\?"/);
  // Voice playback must bypass the automatic-preview guard while coach is active.
  vm.runInContext("coachActive = true; coach = { tell: () => {}, cancelPendingAction: () => {}, requireDanceQuestion: () => {} };", context);
  const player = elements.get('preview-player');
  const cd = elements.get('cd-player');
  for (const row of rows) {
    const action = vm.runInContext(`handleCoachAction('play_song', {title:${JSON.stringify(row.dataset.song)}})`, context);
    assert.equal(action.selectedSong, row.dataset.song);
    await action.deferred();
    assert.equal(player.src, row.dataset.preview);
    assert.equal(player.paused, false);
    assert.equal(cd.classList.contains('is-playing'), true, 'disc spins during voice-requested music');
    assert.equal(elements.get('cd-song').textContent, row.dataset.song);
    assert.equal(elements.get('cd-state').textContent, 'NOW PLAYING');
    assert.equal(elements.get('cd-cover').getAttribute('src'), row.querySelector().getAttribute('src'), 'case cover follows the playing song');
    assert.match(elements.get('status').textContent, /Playing song:/);
    row.events.pointerleave();
    await rows[(rows.indexOf(row) + 1) % rows.length].events.pointerenter();
    assert.equal(player.paused, false, 'hover must not stop a voice-requested song');
    assert.equal(player.src, row.dataset.preview, 'hover must not replace a voice-requested song');
  }
  const selected = vm.runInContext("handleCoachAction('play_song', {})", context);
  await selected.deferred();
  assert.equal(player.src, rows[2].dataset.preview, 'untitled request uses current selection');
  const before = player.src;
  assert.match(vm.runInContext("handleCoachAction('play_song', {title:'unavailable'}).error", context), /not on/);
  assert.equal(player.src, before, 'unknown song must not substitute audio');
  vm.runInContext("handleCoachAction('stop_song', {})", context);
  assert.equal(player.paused, true);
  assert.equal(player.currentTime, 0);
  assert.equal(cd.classList.contains('is-playing'), false, 'stopping music freezes the disc');
  assert.equal(elements.get('cd-cover').getAttribute('src'), rows[2].querySelector().getAttribute('src'), 'stopping audio keeps the selected song cover');
  const chosen = vm.runInContext("handleCoachAction('select_song', {title:'Shake It Off'})", context);
  assert.equal(chosen.queued, true, 'voice selection must also queue audio');
  assert.equal(elements.get('cd-cover').getAttribute('src'), rows[1].querySelector().getAttribute('src'), 'voice selection updates the cover before queued playback starts');
  assert.equal(elements.get('cd-song').textContent, 'Shake It Off');
  assert.equal(cd.classList.contains('is-playing'), false, 'queued selection must not show a spinning disc');
  await chosen.deferred();
  assert.equal(player.src, rows[1].dataset.preview);
  assert.equal(player.paused, false);
  const next = vm.runInContext("handleCoachAction('navigate_song', {direction:'next'})", context);
  assert.equal(next.selectedSong, 'Tell Your World');
  assert.equal(next.deferred, undefined, 'next must start without waiting for coach speech');
  assert.equal(next.playbackAutomatic, true);
  assert.equal(next.playbackStarted, true);
  assert.equal(player.src, rows[2].dataset.preview, 'next immediately starts the row below');
  assert.equal(player.paused, false);
  const lastBoundary = vm.runInContext("handleCoachAction('navigate_song', {direction:'next'})", context);
  assert.equal(lastBoundary.boundaryReached, true);
  assert.equal(lastBoundary.deferred, undefined, 'end of list must not queue or wrap');
  assert.match(lastBoundary.message, /^That's all the songs/);
  for (const row of rows) assert.ok(lastBoundary.message.includes(row.dataset.song));
  assert.equal(player.src, rows[2].dataset.preview);
  assert.equal(player.paused, false, 'boundary must leave the current audio playing');
  const previous = vm.runInContext("handleCoachAction('navigate_song', {direction:'previous'})", context);
  assert.equal(previous.selectedSong, 'Shake It Off', 'previous means row above, not previous listening history');
  assert.equal(player.paused, true, 'previous waits for the coach to announce the name');
  assert.equal(previous.acknowledgment, 'The previous song is Shake It Off. Do you want to dance to it?');
  await previous.deferred();
  assert.equal(player.src, rows[1].dataset.preview);
  const first = vm.runInContext("handleCoachAction('navigate_song', {direction:'previous'})", context);
  await first.deferred();
  assert.equal(player.src, rows[0].dataset.preview);
  const firstBoundary = vm.runInContext("handleCoachAction('navigate_song', {direction:'previous'})", context);
  assert.equal(firstBoundary.boundaryReached, true);
  assert.equal(firstBoundary.selectedSong, 'World Is Mine');
  assert.match(firstBoundary.message, /isn't a song before/);
  assert.equal(player.paused, false);
  assert.match(vm.runInContext("handleCoachAction('navigate_song', {direction:'invalid'}).error", context), /next or previous/);
  player.playError = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
  await vm.runInContext("handleCoachAction('play_song', {title:'World Is Mine'})", context).deferred();
  assert.match(elements.get('status').textContent, /Click the song title/);
  assert.equal(cd.classList.contains('is-playing'), false, 'blocked playback must not spin');
  assert.equal(elements.get('cd-cover').getAttribute('src'), rows[0].querySelector().getAttribute('src'), 'blocked audio keeps the requested song cover');
  player.playError = null;
  rows[1].querySelector().click();
  assert.equal(elements.get('cd-cover').getAttribute('src'), rows[1].querySelector().getAttribute('src'), 'manual selection immediately changes the picture');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.src, rows[1].dataset.preview, 'clicking a title replaces the removed playback button');
  assert.equal(player.paused, false);
  assert.equal(cd.classList.contains('is-playing'), true);
  player.events.waiting();
  assert.equal(cd.classList.contains('is-playing'), false, 'buffering freezes the disc');
  player.events.playing();
  assert.equal(cd.classList.contains('is-playing'), true, 'resumed playback spins again');
  player.events.pause();
  assert.equal(cd.classList.contains('is-playing'), false, 'native audio pause freezes the disc');
  player.events.playing();
  player.events.ended();
  assert.equal(cd.classList.contains('is-playing'), false, 'natural track ending freezes the disc');
  vm.runInContext('coachActive = false', context);
  await rows[0].events.pointerenter();
  assert.equal(cd.classList.contains('is-playing'), true, 'hover preview spins the same disc');
  rows[0].events.pointerleave();
  assert.equal(cd.classList.contains('is-playing'), false, 'leaving a preview freezes the disc');
  assert.equal(elements.get('cd-cover').getAttribute('src'), rows[1].querySelector().getAttribute('src'), 'ending a hover preview restores the selected cover');
  assert.ok(setup.tools[0].functionDeclarations.some(tool => tool.name === 'play_song'));

});

test('song volume ducks for either speaker and restores after both are quiet', () => {
  const ducker = new SongVolumeDucker();
  let time = 0;
  const advance = (rms, coachSpeaking, duration) => {
    const values = [];
    for (let elapsed = 0; elapsed < duration; elapsed += 20) {
      time += 20;
      values.push(ducker.update(rms, coachSpeaking, time));
    }
    return values;
  };
  advance(0.005, false, 1000);
  assert.equal(ducker.volume, 1, 'quiet room noise must leave normal volume alone');
  advance(0.07, false, 500);
  assert.equal(ducker.volume, 0.18, 'user speech lowers the song');
  advance(0.005, false, 400);
  assert.equal(ducker.volume, 0.18, 'short speech pauses must not pump the volume');
  advance(0.005, true, 500);
  assert.equal(ducker.volume, 0.18, 'coach keeps the song low after user stops');
  const recovery = advance(0.005, false, 2000);
  assert.ok(recovery.some(volume => volume > 0.18 && volume < 1), 'recovery must fade smoothly');
  assert.equal(ducker.volume, 1, 'normal volume returns after both are quiet');
  advance(0.005, true, 500);
  assert.equal(ducker.volume, 0.18, 'coach speech alone also lowers the song');
  assert.equal(ducker.reset(), 1, 'stopping the coach must not leave music quiet');
  advance(0.09, false, 20);
  advance(0.005, false, 200);
  assert.equal(ducker.volume, 1, 'a brief click is not sustained speech');
});

function questionCoach(onAction = () => ({})) {
  const sent = [], transcripts = [], played = [];
  const coach = new GeminiCoach({ onStatus: () => {}, onTranscript: (_, text) => transcripts.push(text), onLevel: () => {}, onAction, onStopped: () => {} });
  coach.ready = true;
  coach.send = message => sent.push(message);
  coach.context = { createBuffer: () => ({ copyToChannel: () => {} }) };
  coach.playBuffer = buffer => { played.push(buffer); coach.sources.add(buffer); coach.turnComplete = false; };
  return { coach, sent, transcripts, played };
}

test('missing dance question is spoken explicitly after the selection acknowledgment', async t => {
  let musicStarted = false;
  let audioRequests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    audioRequests++;
    return { ok: true, json: async () => ({ data: encodePCM(new Int16Array([0, 1, 0]).buffer), mimeType: 'audio/pcm;rate=24000' }) };
  });
  const { coach, sent, transcripts, played } = questionCoach(() => ({ queued: true, playbackAutomatic: true, selectedSong: 'Shake It Off', deferred: () => { musicStarted = true; } }));
  coach.handleMessage({ toolCall: { functionCalls: [{ id: 'select-taylor', name: 'select_song', args: { title: 'Shake It Off' } }] } });
  // This is the exact reply the user reported as broken.
  coach.handleMessage({ serverContent: { outputTranscription: { text: 'I have selected Shake It Off for you.' }, turnComplete: true } });
  await coach.questionTask;
  assert.equal(audioRequests, 1);
  assert.equal(played.length, 1, 'fixed question audio must actually be scheduled');
  assert.match(transcripts.at(-1), /Do you want to dance to it\?$/);
  assert.equal(sent.at(-1).clientContent.turns[0].role, 'model');
  assert.equal(sent.at(-1).clientContent.turns[0].parts[0].text, 'Do you want to dance to it?');
  assert.equal(musicStarted, false, 'wait for question audio, not for user permission to play');
  coach.sources.clear(); coach.turnComplete = true; coach.finishTurn();
  assert.equal(musicStarted, true);
  coach.finishTurn();
  assert.equal(played.length, 1, 'question must not repeat on extra end callbacks');
});

test('question already spoken by Gemini is not asked twice', () => {
  let musicStarted = false;
  const { coach, played } = questionCoach(() => ({ queued: true, playbackAutomatic: true, deferred: () => { musicStarted = true; } }));
  coach.handleTools([{ id: 'has-question', name: 'select_song', args: {} }]);
  coach.handleMessage({ serverContent: { outputTranscription: { text: 'Great choice. Do you want ' } } });
  coach.handleMessage({ serverContent: { outputTranscription: { text: 'to dance to it?' }, turnComplete: true } });
  assert.equal(musicStarted, true);
  assert.equal(played.length, 0);
  assert.equal(coach.questionTask, undefined);
});

test('immediate next playback still requires the dance question', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ data: 'AAA=', mimeType: 'audio/pcm;rate=24000' }) }));
  const { coach, transcripts, played } = questionCoach(() => ({ queued: false, playbackAutomatic: true, playbackStarted: true, selectedSong: 'Tell Your World' }));
  coach.handleTools([{ id: 'immediate-next', name: 'navigate_song', args: { direction: 'next' } }]);
  coach.handleMessage({ serverContent: { outputTranscription: { text: 'Enjoy!' }, turnComplete: true } });
  await coach.questionTask;
  assert.equal(played.length, 1);
  assert.match(transcripts.at(-1), /Do you want to dance to it\?$/);
});

test('canceling selection while TTS loads prevents a stale question', async t => {
  let completeRequest;
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { completeRequest = resolve; }));
  const { coach, played } = questionCoach();
  coach.requireDanceQuestion();
  coach.handleMessage({ serverContent: { outputTranscription: { text: 'Selected.' }, turnComplete: true } });
  coach.cancelPendingAction();
  completeRequest({ ok: true, json: async () => ({ data: 'AAA=', mimeType: 'audio/pcm;rate=24000' }) });
  await coach.questionTask;
  assert.equal(played.length, 0);
});

test('browser speaks the exact question if Gemini TTS access is unavailable', async t => {
  let utterance;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  const previousWindow = globalThis.window;
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  globalThis.window = { SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, speechSynthesis: { speak: value => { utterance = value; }, cancel: () => {} } };
  const { coach, transcripts } = questionCoach();
  coach.requireDanceQuestion();
  coach.handleMessage({ serverContent: { outputTranscription: { text: 'Selected.' }, turnComplete: true } });
  await coach.questionTask;
  assert.equal(utterance.text, 'Do you want to dance to it?');
  assert.equal(coach.localSpeaking, true);
  utterance.onstart(); utterance.onend();
  assert.match(transcripts.at(-1), /Do you want to dance to it\?$/);
  assert.equal(coach.localSpeaking, false);
});

test('fixed question endpoint keeps key private and caches Gemini Kore speech', async t => {
  let requests = 0;
  const server = createServer({ apiKey: 'private-test-key', fetchToken: async (url, options) => {
    requests++;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    const body = JSON.parse(options.body);
    assert.equal(body.input[0].content[0].text, 'Do you want to dance to it?');
    assert.equal(body.generation_config.speech_config[0].voice, 'Kore');
    return { ok: true, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: 'fixed-audio', mime_type: 'audio/wav' }] }] }) };
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/dance-question', { method: 'POST' })).status, 403);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(base + '/api/dance-question', { method: 'POST', headers: { Origin: base, 'X-Step-Dance': 'voice-coach' } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data, 'fixed-audio');
    assert.equal(JSON.stringify(body).includes('private-test-key'), false);
  }
  assert.equal(requests, 1, 'same fixed recording is reused');
});

test('arrival hint and Space start the coach without stealing native keyboard controls', () => {
  const events = {}, spoken = [];
  let starts = 0, canceled = 0, resumes = 0, active = false;
  const surface = { addEventListener: (name, fn) => { events[name] = fn; }, speechSynthesis: { speak: utterance => spoken.push(utterance.text), cancel: () => canceled++ }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } };
  createCoachStartup({ surface, isActive: () => active, start: () => { starts++; active = true; }, onActive: () => resumes++ });
  assert.equal(spoken[0], 'Press space bar to start the voice coach');
  assert.equal(starts, 0, 'arrival must not enable microphone before activation');
  let prevented = 0;
  const space = { code: 'Space', key: ' ', target: { closest: () => null }, preventDefault: () => prevented++ };
  events.keydown({ ...space, repeat: true });
  events.keydown({ ...space, ctrlKey: true });
  events.keydown({ ...space, target: { isContentEditable: true } });
  events.keydown({ ...space, target: { closest: () => ({ tagName: 'BUTTON' }) } });
  assert.equal(starts, 0);
  assert.equal(prevented, 0);
  events.keydown(space);
  assert.equal(starts, 1);
  assert.equal(canceled, 1, 'startup hint stops before Gemini greeting');
  assert.equal(prevented, 1);
  events.keydown(space);
  assert.equal(starts, 1, 'Space must not open duplicate sessions');
  assert.equal(resumes, 1, 'a blocked audio context can be resumed with Space');
});

test('home page Space opens the song page with an explicit coach-start intent', async () => {
  const events = {};
  let click;
  const surface = { addEventListener: (name, fn) => { events[name] = fn; }, location: {} };
  const context = { createCoachStartup, window: surface, document: { getElementById: () => ({ addEventListener: (_, fn) => { click = fn; } }) } };
  vm.createContext(context);
  vm.runInContext((await readFile(new URL('../js/home-coach-startup.js', import.meta.url), 'utf8')).replace(/^import .*\n/, ''), context);
  events.keydown({ code: 'Space', target: {}, preventDefault: () => {} });
  assert.equal(surface.location.href, 'songs.html?startCoach=1');
  click();
  assert.equal(surface.location.href, 'songs.html?startCoach=1');
});
