export function pausePageMusic(doc = document) {
  const players = [...doc.querySelectorAll('audio')];
  const MediaEvent = doc.defaultView?.Event || Event;
  for (const player of players) {
    player.autoplay = false;
    // Cancel any pending automatic playback before pausing the media.
    player.dispatchEvent?.(new MediaEvent('step-dance:pause-music'));
    player.pause();
  }
  return {
    musicPaused: true,
    pausedPlayers: players.length,
    message: players.length ? 'All music is paused. Keep listening.' : 'No music is playing on this page. Keep listening.'
  };
}
