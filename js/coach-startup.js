const STARTUP_HINT = 'Press space bar to start the voice coach';

// Arrival speech needs no microphone or Gemini session. Some browsers block
// speech before interaction; the same hint is always visible on both pages.
export function createCoachStartup({ surface, isActive, start, onActive = () => {}, announce = true, coachButton = null }) {
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
  const isCoachControl = target => Boolean(coachButton && (target === coachButton || coachButton.contains?.(target)));
  surface.addEventListener('keydown', event => {
    if (!(event.code === 'Space' || event.key === ' ')) return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    // Space starts or resumes the coach even when its Stop button has focus.
    // Preserve typing and keyboard activation of the other page controls.
    if (event.target?.isContentEditable || (!isCoachControl(event.target) && event.target?.closest?.('input, textarea, select, button, a, [contenteditable]'))) return;
    event.preventDefault();
    stopHint();
    if (isActive()) onActive();
    else start();
  });
  surface.addEventListener('keyup', event => {
    if ((event.code === 'Space' || event.key === ' ') && isCoachControl(event.target)
      && !event.ctrlKey && !event.metaKey && !event.altKey) event.preventDefault();
  });
  surface.addEventListener('pagehide', stopHint);
  return { stopHint };
}
