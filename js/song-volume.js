// Lower music for speech, hold across short pauses, then restore smoothly.
export class SongVolumeDucker {
  constructor(normalVolume = 1, speechVolume = 0.18) {
    this.normalVolume = normalVolume;
    this.speechVolume = speechVolume;
    this.reset();
  }

  reset() {
    this.volume = this.normalVolume;
    this.noiseFloor = 0.006;
    this.speechSince = null;
    this.lastSpeechAt = -Infinity;
    this.lastUpdateAt = null;
    return this.volume;
  }

  update(microphoneLevel, coachSpeaking, now) {
    const elapsed = this.lastUpdateAt === null ? 16 : Math.max(0, now - this.lastUpdateAt);
    this.lastUpdateAt = now;
    // Echo cancellation is enabled on the microphone. Ignore quiet room noise,
    // and require sustained sound so a click does not repeatedly duck the song.
    const threshold = Math.max(0.018, this.noiseFloor * 3);
    if (microphoneLevel > threshold) {
      this.speechSince ??= now;
      if (now - this.speechSince >= 50) this.lastSpeechAt = now;
    } else {
      this.speechSince = null;
      if (!coachSpeaking) {
        const blend = 1 - Math.exp(-elapsed / 2000);
        this.noiseFloor += (Math.min(microphoneLevel, 0.015) - this.noiseFloor) * blend;
      }
    }
    if (coachSpeaking) this.lastSpeechAt = now;
    const speaking = coachSpeaking || now - this.lastSpeechAt < 650;
    const target = speaking ? this.speechVolume : this.normalVolume;
    const transitionMs = speaking ? 55 : 180;
    this.volume += (target - this.volume) * (1 - Math.exp(-elapsed / transitionMs));
    if (Math.abs(this.volume - target) < 0.002) this.volume = target;
    return this.volume;
  }
}
