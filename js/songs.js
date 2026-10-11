import { GeminiCoach } from './gemini-coach.js';
import { SongVolumeDucker } from './song-volume.js';
import { createCoachStartup } from './coach-startup.js';

const songRows = [...document.querySelectorAll('.song-row')];
const statusMessage = document.getElementById('status');
const previewPlayer = document.getElementById('preview-player');
const coachButton = document.getElementById('coach-button');
const coachStatus = document.getElementById('coach-status');
const coachTranscript = document.getElementById('coach-transcript');
const danceButton = document.getElementById('dance-button');
const voiceWave = document.getElementById('voice-wave');
const waveBars = document.getElementById('wave-bars');
let selectedRow = songRows.find((row) => row.classList.contains('selected'));
let activePreviewRow = null;
let previewStarting = false;
let requestedPlayback = false;
let previewRequestId = 0;
let coachActive = false;
let coach;
let coachActionInProgress = false;
const songVolume = new SongVolumeDucker(previewPlayer.volume);

for (let index = 0; index < 36; index += 1) {
  waveBars.append(document.createElement('span'));
}
const waveColumns = [...waveBars.children];

function startCoach() {
  if (coachActive) { coach?.resumeAudio(); return; }
  startupCue.stopHint();
  coachActive = true;
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
      voiceWave.hidden = false;
      voiceWave.querySelector('.wave-label').textContent = speaking ? 'COACH SPEAKING' : ready ? 'MIC LIVE' : 'CONNECTING';
      waveColumns.forEach((column, index) => {
        column.style.height = `${5 + Math.min(1, volume * 12) * (12 + 22 * Math.abs(Math.sin(index * 1.71)))}px`;
      });
    },
    onAction: handleCoachAction,
    onStopped: () => {
      previewPlayer.volume = songVolume.reset();
      coachActive = false;
      voiceWave.hidden = true;
      coachButton.textContent = 'Start voice coach';
      coachButton.setAttribute('aria-pressed', 'false');
    }
  });
  coach.start();
}

function stopCoach() {
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
    return queueSong(row);
  }
  if (name === 'stop_song') {
    coach?.cancelPendingAction();
    stopPreview();
    statusMessage.textContent = 'Song audio stopped';
    return { stopped: true };
  }
  if (name === 'dance') {
    coach?.cancelPendingAction();
    // Use the same button handler as a mouse or keyboard click.
    coachActionInProgress = true;
    try { danceButton.click(); } finally { coachActionInProgress = false; }
    return { selectedSong: selectedRow.dataset.song, dancePageReady: false, message: 'Dance button clicked. Dance page is still being built.' };
  }
  if (name === 'go_home') {
    coach?.cancelPendingAction();
    return { deferred: () => { stopCoach(); window.location.href = 'StepDanceHome.html'; } };
  }
  if (name === 'pause_coach') {
    coach?.cancelPendingAction();
    return { deferred: stopCoach };
  }
  return { error: 'Unsupported page action.' };
}

function queueSong(row) {
  coach?.cancelPendingAction();
  stopPreview();
  selectSong(row, false);
  statusMessage.textContent = `${row.dataset.song} queued — playing after the coach finishes`;
  return {
    selectedSong: row.dataset.song,
    queued: true,
    playbackAutomatic: true,
    acknowledgment: `Great choice! Starting ${row.dataset.song} now. Do you want to dance to it?`,
    deferred: () => playRequestedSong(row)
  };
}

function selectSong(row, preview = true) {
  selectedRow = row;

  for (const songRow of songRows) {
    const isSelected = songRow === selectedRow;
    songRow.classList.toggle('selected', isSelected);
    songRow.querySelector('.song-select').setAttribute('aria-pressed', String(isSelected));
  }

  statusMessage.textContent = `${selectedRow.dataset.song} selected`;
  if (preview) {
    if (coachActive) {
      coach?.cancelPendingAction();
      coach.requireDanceQuestion();
      coach.tell(`Page event: the user clicked ${row.dataset.song}. It is now selected and the page is starting its audio automatically. Say "Great choice! Starting ${row.dataset.song} now. Do you want to dance to it?" Do not ask for playback confirmation or call a tool. Wait for the user's answer to the dance question while the audio plays.`);
      playRequestedSong(row);
    } else {
      playPreview(row, requestedPlayback);
    }
  }
}

function stopPreview() {
  previewRequestId += 1;
  requestedPlayback = false;
  activePreviewRow = null;
  previewStarting = false;
  previewPlayer.pause();
  previewPlayer.currentTime = 0;
}

async function playRequestedSong(row) {
  const result = await playPreview(row, true);
  if (result?.error && coachActive) coach.tell(`Playback failed: ${result.error}. Explain this briefly. The user can click the song title to try again. Do not call play_song again automatically.`);
}

async function playPreview(row, requested = false) {
  if (!requested && (coachActive || requestedPlayback)) {
    if (requestedPlayback) return;
    statusMessage.textContent = `${row.dataset.song} — previews are paused while the voice coach is on`;
    return { error: 'Automatic previews are paused while the coach is on.' };
  }
  if (!row.dataset.preview) {
    statusMessage.textContent = `No preview is available for ${row.dataset.song}`;
    return { error: `No audio is available for ${row.dataset.song}.` };
  }

  if (activePreviewRow === row && (previewStarting || !previewPlayer.paused)) {
    return;
  }

  stopPreview();
  const requestId = previewRequestId;
  requestedPlayback = requested;
  activePreviewRow = row;
  previewPlayer.src = row.dataset.preview;
  previewPlayer.load();
  previewStarting = true;

  try {
    await previewPlayer.play();
    if (activePreviewRow === row && requestId === previewRequestId) {
      statusMessage.textContent = `Playing ${requested ? 'song' : 'preview'}: ${row.dataset.song}`;
      return { playing: row.dataset.song };
    }
  } catch (error) {
    if (activePreviewRow === row && requestId === previewRequestId) {
      activePreviewRow = null;
      requestedPlayback = false;

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

for (const row of songRows) {
  row.querySelector('.song-select').addEventListener('click', () => selectSong(row));
  row.addEventListener('pointerenter', () => playPreview(row));
  row.addEventListener('pointerleave', () => {
    if (requestedPlayback) return;
    stopPreview();
    statusMessage.textContent = 'Hover over a song to hear a preview';
  });
  row.addEventListener('focusin', () => playPreview(row));
  row.addEventListener('focusout', (event) => {
    if (!requestedPlayback && !row.contains(event.relatedTarget)) {
      stopPreview();
      statusMessage.textContent = 'Hover over a song to hear a preview';
    }
  });
}

previewPlayer.addEventListener('error', () => {
  if (activePreviewRow) {
    statusMessage.textContent = `Could not load preview for ${activePreviewRow.dataset.song}`;
    activePreviewRow = null;
    requestedPlayback = false;
  }
});

previewPlayer.addEventListener('ended', () => {
  if (activePreviewRow) {
    statusMessage.textContent = `Preview finished: ${activePreviewRow.dataset.song}`;
    activePreviewRow = null;
    requestedPlayback = false;
  }
});

coachButton.addEventListener('click', () => {
  if (coachActive) {
    if (coach?.context?.state === 'suspended' && !coach.ready) coach.resumeAudio();
    else stopCoach();
  } else {
    startCoach();
  }
});

danceButton.addEventListener('click', () => {
  stopPreview();
  statusMessage.textContent = `${selectedRow.dataset.song} selected. Dance mode is not connected yet`;
  if (coachActive && !coachActionInProgress) {
    coach.tell(`Page event: the user clicked Dance for ${selectedRow.dataset.song}. The dance page is unfinished. Encourage them and explain this briefly. Do not call dance again.`);
  }
});

// Release the microphone when leaving this page.
window.addEventListener('pagehide', stopCoach);
const requestedCoachStart = new URLSearchParams(window.location.search || '').get('startCoach') === '1';
const startupCue = createCoachStartup({
  surface: window,
  isActive: () => coachActive,
  start: startCoach,
  onActive: () => coach?.resumeAudio(),
  announce: !requestedCoachStart
});
if (requestedCoachStart) {
  // Consume the navigation intent so a later refresh does not restart the mic.
  const url = new URL(window.location.href);
  url.searchParams.delete('startCoach');
  window.history.replaceState(null, '', url);
  startCoach();
}
