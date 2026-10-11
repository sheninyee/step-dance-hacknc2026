// Practice coach: while recording, show and speak a randomly chosen coaching tip every 6 seconds.
const coachTips = [
  'Move your left arm higher up!',
  'That looks great!',
  'You may need to speed up that part to get on beat.',
  'Your left leg could move closer to your body for stability.',
  'You got this!'
];
let coachTimer;
let lastTip;

function giveTip() {
  // Pick at random, but never the same tip twice in a row.
  let tip;
  do { tip = coachTips[Math.floor(Math.random() * coachTips.length)]; } while (tip === lastTip);
  lastTip = tip;
  document.querySelector('.feedback-text').textContent = tip;
  // ElevenLabs voice, falling back to the browser voice when it is unavailable.
  new Audio('/api/speak?text=' + encodeURIComponent(tip)).play()
    .catch(() => speechSynthesis.speak(new SpeechSynthesisUtterance(tip)));
}

document.getElementById('start-btn').addEventListener('click', () => { coachTimer = setInterval(giveTip, 6000); });
document.getElementById('stop-btn').addEventListener('click', () => clearInterval(coachTimer));
