const STARTUP_HINT = 'Press space bar to start the voice coach';

// Arrival speech needs no microphone or Gemini session. Some browsers block
// speech before interaction; the same hint is always visible on both pages.
export function createCoachStartup({ surface, isActive, start, onActive = () => {}, announce = true }) {
  let hintPending = false;
  const stopHint = () => {
    if (hintPending) surface.speechSynthesis?.cancel();
    hintPending = false;
  };
  if (announce && surface.speechSynthesis && surface.SpeechSynthesisUtterance) {
    const utterance = new surface.SpeechSynthesisUtterance(STARTUP_HINT);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    utterance.pitch = 1.1;
    utterance.onend = utterance.onerror = () => { hintPending = false; };
    hintPending = true;
    try { surface.speechSynthesis.speak(utterance); } catch { hintPending = false; }
  }
  surface.addEventListener('keydown', event => {
    if (!(event.code === 'Space' || event.key === ' ')) return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    // Preserve typing and normal keyboard activation of buttons and links.
    if (event.target?.isContentEditable || event.target?.closest?.('input, textarea, select, button, a, [contenteditable]')) return;
    event.preventDefault();
    stopHint();
    if (isActive()) onActive();
    else start();
  });
  surface.addEventListener('pagehide', stopHint);
  return { stopHint };
}
