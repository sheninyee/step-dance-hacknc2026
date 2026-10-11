import { GeminiCoach } from './gemini-coach.js';
import { SongVolumeDucker } from './song-volume.js';
import { createCoachStartup } from './coach-startup.js';
import { createMicMeter, coachEnabled, rememberCoach } from './voice-ui.js';
import { pausePageMusic } from './music-controls.js';

const songRows = [...document.querySelectorAll('.song-row')];
const statusMessage = document.getElementById('status');
const previewPlayer = document.getElementById('preview-player');
const cdPlayer = document.getElementById('cd-player');
const cdState = document.getElementById('cd-state');
const cdSong = document.getElementById('cd-song');
const cdCover = document.getElementById('cd-cover');
const coachButton = document.getElementById('coach-button');
const coachStatus = document.getElementById('coach-status');
const coachTranscript = document.getElementById('coach-transcript');
const danceButton = document.getElementById('dance-button');
const voiceWave = document.getElementById('voice-wave');
let selectedRow = songRows.find((row) => row.classList.contains('selected')) || songRows[0];
let selectedCoverRow = null;
let activePreviewRow = null;
let previewStarting = false;
let requestedPlayback = false;
let hoverPreviewRow = null;
let playbackAfterPreview = null;
let previewRequestId = 0;
let musicPaused = false;
let coachActive = false;
let coach;
let coachActionInProgress = false;
const songVolume = new SongVolumeDucker(previewPlayer.volume);

const micMeter = createMicMeter(voiceWave, document);

function startCoach() {
  if (coachActive) { coach?.resumeAudio(); return; }
  startupCue.stopHint();
  rememberCoach(true, window);
  coachActive = true;
  micMeter.update();
  stopPreview();
  coachButton.textContent = 'Stop voice coach';
  coachButton.setAttribute('aria-pressed', 'true');
  coachTranscript.textContent = '';
  coach = new GeminiCoach({
    initialSong: selectedRow.dataset.song,
    onStatus: message => {
      coachStatus.textContent = message;
      const audioBlocked = coach?.context?.state === 'suspended' && !coach.ready;
      coachButton.textContent = !coachActive || audioBlocked ? 'Start voice coach' : 'Stop voice coach';
    },
    onTranscript: (user, reply) => {
      coachTranscript.textContent = [user && `You: ${user}`, reply && `Coach: ${reply}`].filter(Boolean).join(' — ');
    },
    onLevel: (volume, speaking, ready) => {
      previewPlayer.volume = songVolume.update(volume, speaking, performance.now());
      micMeter.update(volume, speaking, ready);
    },
    onAction: handleCoachAction,
    onStopped: () => {
      previewPlayer.volume = songVolume.reset();
      coachActive = false;
      micMeter.hide();
      coachButton.textContent = 'Start voice coach';
      coachButton.setAttribute('aria-pressed', 'false');
    }
  });
  coach.start();
}

function stopCoach(forget = true) {
  if (forget) rememberCoach(false, window);
  coach?.stop();
  coachStatus.textContent = 'Voice coach paused. Press Space or select Start whenever you want to talk again.';
}

function handleCoachAction(name, args) {
  if (name === 'play_song' || name === 'select_song') {
    const row = args.title === undefined ? selectedRow : songRows.find(row => row.dataset.song === args.title);
    if (!row) return { error: 'That song is not on this page. Ask for one of the three available songs.' };
    return queueSong(row);
  }
  if (name === 'navigate_song') {
    const step = args.direction === 'next' ? 1 : args.direction === 'previous' ? -1 : 0;
    if (!step) return { error: 'Choose next or previous.' };
    const index = songRows.indexOf(selectedRow);
    const row = songRows[index + step];
    if (!row) {
      const titles = songRows.map(row => row.dataset.song);
      const choices = titles.length > 1 ? `${titles.slice(0, -1).join(', ')}, and ${titles.at(-1)}` : titles[0];
      const message = step > 0
        ? `That's all the songs, but we have ${choices}. Which would you like?`
        : `There isn't a song before this one, but we have ${choices}. Which would you like?`;
      statusMessage.textContent = message;
      return { boundaryReached: true, selectedSong: selectedRow.dataset.song, availableSongs: titles, message };
    }
    return queueSong(row, { playImmediately: step > 0, previous: step < 0 });
  }
  if (name === 'stop_song') {
    coach?.cancelPendingAction();
    stopPreview();
    statusMessage.textContent = 'Song audio stopped';
    return { stopped: true };
  }
  if (name === 'pause_music') {
    coach?.cancelPendingAction();
    previewRequestId += 1;
    previewStarting = false;
    musicPaused = true;
    requestedPlayback = false;
    hoverPreviewRow = null;
    playbackAfterPreview = null;
    const result = pausePageMusic(document);
    updateCDPlayer(false);
    statusMessage.textContent = 'Music paused';
    return result;
  }
  if (name === 'dance') {
    coach?.cancelPendingAction();
    coachActionInProgress = true;
    try { danceButton.click(); } finally { coachActionInProgress = false; }
    return { selectedSong: selectedRow.dataset.song, dancePageReady: true, message: 'Opening Practice page...' };
  }
  if (name === 'go_home' || name === 'navigate_page') {
    const page = name === 'go_home' ? 'home' : args.page;
    const routes = { home: 'StepDanceHome.html', songs: 'songs.html', practice: 'practice.html', settings: 'settings.html' };
    if (!Object.hasOwn(routes, page)) return { error: 'Choose home, songs, practice, or settings.' };
    if (page === 'songs') return { currentPage: 'songs', message: 'You are already on the song list page.' };
    coach?.cancelPendingAction();
    return { deferred: () => { stopCoach(false); window.location.href = routes[page]; } };
  }
  if (name === 'pause_coach') {
    coach?.cancelPendingAction();
    return { deferred: stopCoach };
  }
  return { error: 'Unsupported page action.' };
}

function queueSong(row, { playImmediately = false, previous = false } = {}) {
  coach?.cancelPendingAction();
  const startTime = musicPaused && activePreviewRow === row ? previewPlayer.currentTime : 0;
  stopPreview();
  selectSong(row, false);
  const result = {
    selectedSong: row.dataset.song,
    queued: !playImmediately,
    playbackAutomatic: true,
    acknowledgment: previous
      ? `The previous song is ${row.dataset.song}. Do you want to dance to it?`
      : playImmediately
        ? 'Do you want to dance to it?'
        : `Great choice! Starting ${row.dataset.song} now. Do you want to dance to it?`
  };
  if (playImmediately) {
    playRequestedSong(row, startTime);
    return { ...result, playbackStarted: true };
  }
  statusMessage.textContent = `${row.dataset.song} queued — playing after the coach finishes`;
  return { ...result, deferred: () => playRequestedSong(row, startTime) };
}

function selectSong(row, preview = true) {
  selectedRow = row;
  selectedCoverRow = row;
  updateCDPlayer(cdPlayer.classList.contains('is-playing'), row);

  for (const songRow of songRows) {
    const isSelected = songRow === selectedRow;
    songRow.classList.toggle('selected', isSelected);
    songRow.querySelector('.song-select')?.setAttribute('aria-pressed', String(isSelected));
  }

  statusMessage.textContent = `${selectedRow.dataset.song} selected`;
  if (preview) {
    if (coachActive) {
      coach?.cancelPendingAction();
      coach.requireDanceQuestion();
      coach.tell(`Page event: the user clicked ${row.dataset.song}. It is now selected and the page is starting its audio automatically. Say "Great choice! Starting ${row.dataset.song} now. Do you want to dance to it?" Do not ask for playback confirmation or call a tool. Wait for the user's answer to the dance question while the audio plays.`);
      playRequestedSong(row);
    } else {
      playRequestedSong(row);
    }
  }
}

function stopPreview({ keepHoverPreview = false } = {}) {
  previewRequestId += 1;
  requestedPlayback = false;
  activePreviewRow = null;
  previewStarting = false;
  if (!keepHoverPreview) {
    hoverPreviewRow = null;
    playbackAfterPreview = null;
  }
  previewPlayer.pause();
  previewPlayer.currentTime = 0;
  updateCDPlayer(false);
}

function updateCDPlayer(playing, row = activePreviewRow || selectedCoverRow) {
  if (!cdPlayer) return;
  cdPlayer.classList.toggle('is-playing', playing);
  if (cdState) cdState.textContent = playing ? 'NOW PLAYING' : 'STOPPED';
  if (cdSong) cdSong.textContent = row?.dataset.song || 'Choose a song';
  const cover = row?.querySelector('.album-art')?.getAttribute('src') || 'images/step_dance_cd_cover.png';
  if (cdCover && cdCover.getAttribute('src') !== cover) cdCover.setAttribute('src', cover);
}

async function playRequestedSong(row, startTime = 0) {
  if (musicPaused && activePreviewRow === row) startTime = previewPlayer.currentTime;
  musicPaused = false;
  const result = await playPreview(row, true, { startTime });
  if (result?.error && coachActive) coach.tell(`Playback failed: ${result.error}. Explain this briefly. The user can click the song title to try again. Do not call play_song again automatically.`);
}

async function playPreview(row, requested = false, { keepHoverPreview = false, startTime = 0 } = {}) {
  if (!row.dataset.preview) {
    statusMessage.textContent = `No preview is available for ${row.dataset.song}`;
    return { error: `No audio is available for ${row.dataset.song}.` };
  }

  if (activePreviewRow === row && (previewStarting || !previewPlayer.paused)) {
    if (requested) {
      requestedPlayback = true;
      hoverPreviewRow = null;
      playbackAfterPreview = null;
    }
    return;
  }

  stopPreview({ keepHoverPreview });
  const requestId = previewRequestId;
  requestedPlayback = requested;
  activePreviewRow = row;
  previewPlayer.src = row.dataset.preview;
  previewPlayer.load();
  previewPlayer.currentTime = startTime;
  previewStarting = true;

  try {
    await previewPlayer.play();
    if (activePreviewRow === row && requestId === previewRequestId) {
      updateCDPlayer(true);
      statusMessage.textContent = `Playing ${requestedPlayback ? 'song' : 'preview'}: ${row.dataset.song}`;
      return { playing: row.dataset.song };
    }
  } catch (error) {
    if (activePreviewRow === row && requestId === previewRequestId) {
      activePreviewRow = null;
      requestedPlayback = false;
      updateCDPlayer(false);

      if (error.name === 'NotAllowedError') {
        statusMessage.textContent = 'Your browser blocked audio. Click the song title to hear it.';
      } else if (error.name !== 'AbortError') {
        statusMessage.textContent = `Could not load preview for ${row.dataset.song}`;
      }
      return { error: statusMessage.textContent };
    }
  } finally {
    if (activePreviewRow === row && requestId === previewRequestId) {
      previewStarting = false;
    }
  }
}

function startHoverPreview(row) {
  if (musicPaused) return;
  // Hovering the playing song keeps it at its current position.
  if (activePreviewRow === row && (previewStarting || !previewPlayer.paused)) return;
  if (requestedPlayback && activePreviewRow) {
    playbackAfterPreview = { row: activePreviewRow, time: previewPlayer.currentTime };
  }
  hoverPreviewRow = row;
  return playPreview(row, false, { keepHoverPreview: true });
}

function endHoverPreview(row) {
  if (hoverPreviewRow !== row || requestedPlayback) return;
  const resume = playbackAfterPreview;
  stopPreview();
  if (resume) return playPreview(resume.row, true, { startTime: resume.time });
  statusMessage.textContent = 'Hover over a song to hear a preview';
}

for (const row of songRows) {
  row.querySelector('.song-select')?.addEventListener('click', () => selectSong(row));
  row.addEventListener('pointerenter', () => startHoverPreview(row));
  row.addEventListener('pointerleave', () => endHoverPreview(row));
  row.addEventListener('focusin', () => startHoverPreview(row));
  row.addEventListener('focusout', (event) => {
    if (!row.contains(event.relatedTarget)) endHoverPreview(row);
  });
}

previewPlayer.addEventListener('playing', () => updateCDPlayer(true));
for (const event of ['pause', 'waiting', 'emptied', 'loadstart']) {
  previewPlayer.addEventListener(event, () => updateCDPlayer(false));
}

previewPlayer.addEventListener('error', () => {
  if (activePreviewRow) {
    statusMessage.textContent = `Could not load preview for ${activePreviewRow.dataset.song}`;
    activePreviewRow = null;
    requestedPlayback = false;
  }
  updateCDPlayer(false);
});

previewPlayer.addEventListener('ended', () => {
  if (activePreviewRow) {
    statusMessage.textContent = `Preview finished: ${activePreviewRow.dataset.song}`;
    activePreviewRow = null;
    requestedPlayback = false;
  }
  updateCDPlayer(false);
});

coachButton?.addEventListener('click', () => {
  if (coachActive) {
    if (coach?.context?.state === 'suspended' && !coach.ready) coach.resumeAudio();
    else stopCoach();
  } else {
    startCoach();
  }
});

// PASSES CHOSEN SONG TO PRACTICE PAGE
danceButton?.addEventListener('click', () => {
  stopPreview();
  const title = selectedRow?.dataset.song || 'World Is Mine';
  const audio = selectedRow?.dataset.preview || 'audio/world_is_mine.mp3';
  window.location.href = `practice.html?song=${encodeURIComponent(title)}&audio=${encodeURIComponent(audio)}`;
});

// Release the microphone when leaving this page.
window.addEventListener('pagehide', () => stopCoach(false));
window.addEventListener('pageshow', event => { if (event.persisted && coachEnabled(window)) startCoach(); });
const requestedCoachStart = new URLSearchParams(window.location.search || '').get('startCoach') === '1';
const startupCue = createCoachStartup({
  surface: window,
  coachButton,
  isActive: () => coachActive,
  start: startCoach,
  onActive: () => coach?.resumeAudio(),
  announce: !requestedCoachStart && !coachEnabled(window)
});
if (requestedCoachStart) {
  const url = new URL(window.location.href);
  url.searchParams.delete('startCoach');
  window.history.replaceState(null, '', url);
  startCoach();
} else if (coachEnabled(window)) {
  startCoach();
}
