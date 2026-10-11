// Practice coach: while recording, ask Gemini for a tip about a webcam frame every 6 seconds, then show and speak it.
// If Gemini fails or takes longer than 4 seconds, a randomly chosen tip is used instead.
const coachVideo = document.getElementById('video');
const coachCanvas = document.createElement('canvas');
const coachTips = [
  'Move your left arm higher up!',
  'That looks great!',
  'You may need to speed up that part to get on beat.',
  'Your left leg could move closer to your body for stability.',
  'You got this!'
];
let coachTimer;
let lastTip;

function randomTip() {
  // Pick at random, but never the same tip twice in a row.
  let tip;
  do { tip = coachTips[Math.floor(Math.random() * coachTips.length)]; } while (tip === lastTip);
  lastTip = tip;
  return tip;
}

async function geminiTip() {
  if (!coachVideo.videoWidth) throw new Error('Camera is not ready.');
  coachCanvas.width = 320;
  coachCanvas.height = 320 * coachVideo.videoHeight / coachVideo.videoWidth;
  coachCanvas.getContext('2d').drawImage(coachVideo, 0, 0, coachCanvas.width, coachCanvas.height);
  const response = await fetch('/api/dance-tip', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000),
    body: JSON.stringify({ image: coachCanvas.toDataURL('image/jpeg', 0.6).split(',')[1] })
  });
  if (!response.ok) throw new Error('Gemini did not return a tip.');
  return (await response.json()).tip;
}

async function giveTip() {
  const tip = await geminiTip().catch(randomTip);
  document.querySelector('.feedback-text').textContent = tip;
  // ElevenLabs voice, falling back to the browser voice when it is unavailable.
  new Audio('/api/speak?text=' + encodeURIComponent(tip)).play()
    .catch(() => speechSynthesis.speak(new SpeechSynthesisUtterance(tip)));
}

document.getElementById('start-btn').addEventListener('click', () => { coachTimer = setInterval(giveTip, 6000); });
document.getElementById('stop-btn').addEventListener('click', () => clearInterval(coachTimer));
