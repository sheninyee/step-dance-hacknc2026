const ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const DANCE_QUESTION = 'Do you want to dance to it?';

export function encodePCM(buffer) {
  const samples = new Int16Array(buffer);
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodePCM(data) {
  const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
  if (bytes.length % 2) throw new Error('Invalid Gemini audio.');
  const view = new DataView(bytes.buffer);
  return Float32Array.from({ length: bytes.length / 2 }, (_, index) => view.getInt16(index * 2, true) / 32768);
}

// One microphone stream and one WebSocket for the entire conversation.
export class GeminiCoach {
  constructor({ onStatus, onTranscript, onLevel, onAction, onStopped, initialSong = 'World Is Mine' }) {
    Object.assign(this, { onStatus, onTranscript, onLevel, onAction, onStopped, initialSong });
    this.disposed = false;
    this.ready = false;
    this.sources = new Set();
    this.executedCalls = new Set();
    this.nextAudioAt = 0;
    this.inputText = '';
    this.outputText = '';
    this.questionVersion = 0;
  }

  async start() {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) {
        throw new Error('Live audio needs a modern browser on localhost or HTTPS.');
      }
      this.onStatus('Connecting to Gemini. Please allow microphone access.');
      // Resume directly within the Start button gesture, before asynchronous requests.
      this.context = new AudioContext();
      this.audioUnlockTimer = setTimeout(() => {
        if (!this.disposed && this.context.state === 'suspended') this.onStatus('Press Space or click Start voice coach again to enable audio.');
      }, 1500);
      await this.context.resume();
      clearTimeout(this.audioUnlockTimer);
      if (this.disposed) return;
      this.onStatus('Connecting to Gemini. Please allow microphone access.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true
      } });
      if (this.disposed) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      stream.getTracks().forEach(track => track.addEventListener('ended', () => this.fail('Microphone disconnected. Reconnect it and start the coach again.')));
      await this.context.audioWorklet.addModule('/js/mic-worklet.js');
      if (this.disposed) return;
      this.input = this.context.createMediaStreamSource(stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 512;
      this.input.connect(this.analyser);
      this.worklet = new AudioWorkletNode(this.context, 'coach-microphone');
      this.input.connect(this.worklet);
      // Muted destination keeps capture running without playing microphone audio.
      this.mute = this.context.createGain();
      this.mute.gain.value = 0;
      this.worklet.connect(this.mute).connect(this.context.destination);
      this.worklet.port.onmessage = event => {
        if (!this.ready || this.disposed) return;
        if (this.socket.bufferedAmount > 128000) {
          this.fail('The audio connection is too slow. Check your connection and start again.');
          return;
        }
        this.send({ realtimeInput: { audio: { data: encodePCM(event.data), mimeType: 'audio/pcm;rate=16000' } } });
      };
      this.drawLevel();
      const response = await fetch('/api/gemini-session', {
        method: 'POST', headers: { 'X-Step-Dance': 'voice-coach' }, signal: AbortSignal.timeout(15000)
      });
      if (this.disposed) return;
      let credentials;
      try { credentials = await response.json(); }
      catch { throw new Error('The voice coach could not start. Please refresh the page and try again.'); }
      if (!response.ok) throw new Error(credentials.error || 'Gemini session could not start.');
      this.socket = new WebSocket(`${ENDPOINT}?access_token=${encodeURIComponent(credentials.token)}`);
      this.socket.binaryType = 'arraybuffer';
      this.connectTimer = setTimeout(() => this.fail('Gemini connection timed out. Check API access and try again.'), 15000);
      this.socket.onopen = () => this.send({ setup: credentials.setup });
      this.socket.onmessage = event => {
        if (this.disposed) return;
        try {
          const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
          this.handleMessage(JSON.parse(text));
        } catch { this.fail('Gemini sent an unexpected response. Please start the coach again.'); }
      };
      this.socket.onerror = () => this.fail('Could not connect to Gemini Live. Check your connection and API access.');
      this.socket.onclose = () => this.fail('Gemini session ended. Tap Start voice coach to reconnect.');
    } catch (error) {
      this.fail(error.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow microphone access, then start again.' : error.message);
    }
  }

  send(message) {
    if (!this.disposed && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  resumeAudio() {
    if (!this.disposed && this.context?.state === 'suspended') {
      this.context.resume().catch(() => this.onStatus('Audio is blocked. Press Space or click Start voice coach again.'));
    }
  }

  tell(text) {
    if (this.ready) this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });
  }

  handleMessage(message) {
    if (message.error) { this.fail('Gemini rejected this session. Check your permissions.'); return; } // GEMINI_LIVE_MODEL and API access
    if (message.setupComplete) {
      clearTimeout(this.connectTimer);
      this.ready = true;
      this.onStatus('Gemini is connected. Your coach will greet you now.');
      this.tell(`Current page state: ${this.initialSong} is selected. Greet me with the exact opening question from your instructions, then wait for my voice reply.`);
    }
    const content = message.serverContent;
    if (content) {
      if (content.interrupted) {
        this.questionVersion += 1;
        this.questionInFlight = false;
        this.danceQuestionPending = false;
        this.clearPlayback();
        this.outputText = '';
        this.onStatus('Listening — go ahead, I am here.');
      }
      if (content.inputTranscription?.text) {
        if (this.newInputTurn) { this.inputText = ''; this.outputText = ''; this.newInputTurn = false; }
        this.inputText += content.inputTranscription.text;
        this.onTranscript(this.inputText, this.outputText);
      }
      if (content.outputTranscription?.text) {
        this.outputText += content.outputTranscription.text;
        if (this.danceQuestionPending) this.questionTurnText += content.outputTranscription.text;
        this.onTranscript(this.inputText, this.outputText);
      }
      for (const part of content.modelTurn?.parts || []) {
        if (part.inlineData?.mimeType?.startsWith('audio/pcm')) {
          const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] || 24000);
          this.playAudio(part.inlineData.data, rate);
        }
      }
      if (content.turnComplete) {
        this.newInputTurn = true;
        this.turnComplete = true;
        this.finishTurn();
      }
    }
    if (message.toolCall) this.handleTools(message.toolCall.functionCalls || []);
    if (message.goAway) this.onStatus('This Gemini session is ending soon. Stop and start the coach to reconnect.');
  }

  handleTools(calls) {
    const responses = calls.map(call => {
      let result;
      if (this.executedCalls.has(call.id)) result = { alreadyHandled: true };
      else {
        this.executedCalls.add(call.id);
        result = this.onAction(call.name, call.args || {});
        if (result?.queued && result.playbackAutomatic) this.requireDanceQuestion();
        if (result?.deferred) {
          this.pendingAction = result.deferred;
          // Allow Gemini's spoken acknowledgment to play before leaving/stopping.
          clearTimeout(this.actionTimer);
          this.actionTimer = setTimeout(() => this.runPendingAction(), 12000);
          const { deferred, ...details } = result;
          result = { ...details, result: 'Will execute after your brief spoken acknowledgment.' };
        }
      }
      return { id: call.id, name: call.name, response: result || { error: 'Unsupported action.' } };
    });
    this.send({ toolResponse: { functionResponses: responses } });
  }

  playAudio(data, rate) {
    const samples = decodePCM(data);
    const buffer = this.context.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    this.playBuffer(buffer);
  }

  playBuffer(buffer) {
    this.turnComplete = false;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const at = Math.max(this.context.currentTime + 0.02, this.nextAudioAt);
    this.nextAudioAt = at + buffer.duration;
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); this.finishTurn(); };
    source.start(at);
    this.onStatus('Your Gemini coach is speaking. You can interrupt with your voice.');
  }

  finishTurn() {
    if (!this.disposed && this.turnComplete && this.sources.size === 0 && !this.questionInFlight && !this.localSpeaking) {
      if (this.danceQuestionPending) {
        this.danceQuestionPending = false;
        const normalized = this.questionTurnText.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ');
        if (!normalized.includes('do you want to dance to it')) {
          this.questionInFlight = true;
          this.questionTask = this.askRequiredQuestion(this.questionVersion);
          return;
        }
      }
      if (this.pendingAction) this.runPendingAction();
      else this.onStatus('Listening. Take your time — ask about songs, choose one, or say Dance!');
    }
  }

  requireDanceQuestion() {
    this.questionVersion += 1;
    this.questionInFlight = false;
    this.danceQuestionPending = true;
    this.questionTurnText = '';
  }

  async askRequiredQuestion(version) {
    const current = () => !this.disposed && version === this.questionVersion;
    try {
      this.onStatus('Your coach is getting the dance question ready.');
      // Reuse one fixed Gemini TTS recording in this conversation.
      this.questionAudio ||= fetch('/api/dance-question', {
        method: 'POST', headers: { 'X-Step-Dance': 'voice-coach' }, signal: AbortSignal.timeout(25000)
      }).then(async response => {
        if (!response.ok) throw new Error('Question audio unavailable');
        return response.json();
      });
      const audio = await this.questionAudio;
      if (!current()) return;
      let buffer;
      if (audio.mimeType.startsWith('audio/pcm') || audio.mimeType.startsWith('audio/L16')) {
        const samples = decodePCM(audio.data);
        buffer = this.context.createBuffer(1, samples.length, Number(/rate=(\d+)/.exec(audio.mimeType)?.[1] || 24000));
        buffer.copyToChannel(samples, 0);
      } else {
        const bytes = Uint8Array.from(atob(audio.data), char => char.charCodeAt(0));
        buffer = await this.context.decodeAudioData(bytes.buffer);
      }
      if (!current()) return;
      this.questionInFlight = false;
      // Record the question in Live history so a spoken yes/no refers to dancing.
      this.recordDanceQuestion();
      this.playBuffer(buffer);
      this.turnComplete = true;
    } catch {
      if (!current()) return;
      this.questionAudio = null;
      this.questionInFlight = false;
      if (this.speakBrowserQuestion(version)) return;
      this.finishTurn();
      this.onStatus(`${DANCE_QUESTION} The spoken question could not load; check Gemini TTS access.`);
    }
  }

  recordDanceQuestion() {
    this.send({ clientContent: { turns: [{ role: 'model', parts: [{ text: DANCE_QUESTION }] }], turnComplete: false } });
    this.outputText = `${this.outputText} ${DANCE_QUESTION}`.trim();
    this.onTranscript(this.inputText, this.outputText);
  }

  speakBrowserQuestion(version) {
    // Keep the required question audible if the project cannot access Gemini TTS.
    if (typeof window === 'undefined' || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return false;
    const utterance = new window.SpeechSynthesisUtterance(DANCE_QUESTION);
    utterance.lang = 'en-US';
    utterance.rate = 0.92;
    utterance.pitch = 1.1;
    this.localSpeaking = true;
    const finish = () => {
      if (this.disposed || version !== this.questionVersion) return;
      clearTimeout(this.localSpeechTimer);
      this.localSpeaking = false;
      this.finishTurn();
    };
    utterance.onstart = () => {
      if (!this.disposed && version === this.questionVersion) this.recordDanceQuestion();
    };
    utterance.onend = finish;
    utterance.onerror = () => {
      finish();
      if (!this.disposed) this.onStatus(`${DANCE_QUESTION} Your browser could not play the question aloud.`);
    };
    this.onStatus('Your coach is asking: Do you want to dance to it?');
    window.speechSynthesis.speak(utterance);
    this.localSpeechTimer = setTimeout(finish, 10000);
    return true;
  }

  runPendingAction() {
    if (this.disposed || !this.pendingAction) return;
    clearTimeout(this.actionTimer);
    const action = this.pendingAction;
    this.pendingAction = null;
    action();
  }

  cancelPendingAction() {
    if (this.localSpeaking) this.clearPlayback();
    clearTimeout(this.actionTimer);
    this.pendingAction = null;
    this.questionVersion += 1;
    this.danceQuestionPending = false;
    this.questionInFlight = false;
  }

  drawLevel() {
    if (this.disposed) return;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    const rms = Math.sqrt(data.reduce((total, value) => total + ((value - 128) / 128) ** 2, 0) / data.length);
    this.onLevel(rms, this.sources.size > 0 || Boolean(this.localSpeaking), this.ready);
    this.frame = requestAnimationFrame(() => this.drawLevel());
  }

  clearPlayback() {
    clearTimeout(this.localSpeechTimer);
    if (this.localSpeaking) {
      this.localSpeaking = false;
      window.speechSynthesis.cancel();
    }
    for (const source of this.sources) { source.onended = null; source.stop(); source.disconnect(); }
    this.sources.clear();
    this.nextAudioAt = 0;
  }

  fail(message) {
    if (this.disposed) return;
    this.stop();
    this.onStatus(message);
  }

  stop() {
    if (this.disposed) return;
    this.disposed = true;
    this.questionVersion += 1;
    this.ready = false;
    clearTimeout(this.connectTimer);
    clearTimeout(this.audioUnlockTimer);
    clearTimeout(this.actionTimer);
    cancelAnimationFrame(this.frame);
    this.clearPlayback();
    this.socket?.close();
    if (this.worklet) this.worklet.port.onmessage = null;
    this.input?.disconnect();
    this.worklet?.disconnect();
    this.mute?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    this.context?.close().catch(() => {});
    this.onStopped();
  }
}
