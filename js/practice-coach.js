// Practice coach: while recording, send a webcam frame to Gemini every few seconds and speak its dance tip.
const coachVideo = document.getElementById('video');
const coachCanvas = document.createElement('canvas');
let coachTimer;
let coachBusy = false;

async function askCoach() {
  if (coachBusy || !coachVideo.videoWidth) return;
  coachBusy = true;
  coachCanvas.width = 320;
  coachCanvas.height = 320 * coachVideo.videoHeight / coachVideo.videoWidth;
  coachCanvas.getContext('2d').drawImage(coachVideo, 0, 0, coachCanvas.width, coachCanvas.height);
  try {
    const response = await fetch('/api/dance-tip', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: coachCanvas.toDataURL('image/jpeg', 0.6).split(',')[1] })
    });
    const { tip } = await response.json();
    document.querySelector('.feedback-text').textContent = tip;
    // ElevenLabs voice, falling back to the browser voice when it is unavailable.
    await new Audio('/api/speak?text=' + encodeURIComponent(tip)).play()
      .catch(() => speechSynthesis.speak(new SpeechSynthesisUtterance(tip)));
  } catch {} finally { coachBusy = false; }
}

document.getElementById('start-btn').addEventListener('click', () => { coachTimer = setInterval(askCoach, 6000); });
document.getElementById('stop-btn').addEventListener('click', () => clearInterval(coachTimer));
