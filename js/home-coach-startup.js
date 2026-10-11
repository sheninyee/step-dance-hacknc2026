import { createCoachStartup } from './coach-startup.js';

let opening = false;
function openCoach() {
  if (opening) return;
  opening = true;
  cue.stopHint();
  window.location.href = 'songs.html?startCoach=1';
}
const cue = createCoachStartup({ surface: window, isActive: () => opening, start: openCoach });
document.getElementById('home-coach-button').addEventListener('click', openCoach);
