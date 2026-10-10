(() => {
  let welcomed = false;

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  function getPageName() {
    const current = document.querySelector('[aria-current="page"]');
    return current ? current.textContent.trim() : document.title;
  }

  function startDancing() {
    const startButton = document.getElementById('startButton');
    if (startButton) startButton.click();
    else window.location.href = 'practice.html';
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('a, button, input, textarea, select')) return;
    event.preventDefault();
    if (!welcomed) {
      welcomed = true;
      speak(`Welcome to Step Dance. You are on the ${getPageName()} page. Press enter or space to start dancing.`);
      return;
    }
    startDancing();
  });
})();