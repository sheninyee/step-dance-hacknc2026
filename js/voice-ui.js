export function coachEnabled(surface = window) {
  try { return surface.sessionStorage?.getItem('step-dance-coach') === 'on'; } catch { return false; }
}

export function rememberCoach(enabled, surface = window) {
  try { surface.sessionStorage?.setItem('step-dance-coach', enabled ? 'on' : 'off'); } catch {}
}

export function createMicMeter(element, doc = document) {
  const bars = element.querySelector('.wave-bars');
  if (!bars.children.length) {
    for (let index = 0; index < 36; index++) bars.append(doc.createElement('span'));
  }
  const columns = [...bars.children];
  const label = element.querySelector('.wave-label');
  return {
    hide() { element.hidden = true; },
    update(level = 0, speaking = false, ready = false) {
      element.hidden = false;
      const userSpeaking = ready && level > 0.018;
      label.textContent = userSpeaking ? 'YOU SPEAKING' : speaking ? 'COACH SPEAKING' : ready ? 'MIC LIVE' : 'CONNECTING';
      element.dataset.speaking = String(userSpeaking || speaking);
      columns.forEach((column, index) => {
        column.style.height = `${5 + Math.min(1, level * 12) * (12 + 22 * Math.abs(Math.sin(index * 1.71)))}px`;
      });
    }
  };
}

const clean = text => (text || '').replace(/\s+/g, ' ').trim();
export function pageReading(page, doc = document) {
  if (page === 'home') {
    const title = clean(doc.querySelector('.logo-text')?.textContent) || 'Step Dance';
    const subtitle = clean(doc.querySelector('.subheading')?.textContent);
    const links = [...doc.querySelectorAll('.nav-links a')].map(link => clean(link.textContent)).join(', ');
    return `${title}. ${subtitle} ${links ? `Navigation: ${links}.` : ''} Say Ready to open the song list, or ask me a question. I'm listening — you can speak at any time.`.replace(/\s+/g, ' ').trim();
  }
  if (page === 'settings') return 'Settings. Songlist opens the song list. Resume returns to your previous page. Reset Stage returns to the home page. Save practice on Solana records your practice using your wallet.';
  return 'Start recording.';
}
