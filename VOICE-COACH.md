# Step Dance — Gemini voice coach

The app uses Gemini Live for **audio understanding, transcription, conversation, and generated speech**. Browser `SpeechRecognition` is not used. Gemini Live reads the start page and supplies conversational speech; browser speech synthesis is a fallback for the mandatory dance question if Gemini TTS is unavailable. The default model is `gemini-3.8-live`, with the **Kore** voice and an enthusiastic, patient dance coach instruction. The model can be overridden in `.env` if your Gemini project uses a different Live audio model. After selection, the client checks the actual generated transcript for “Do you want to dance to it?”. If Live omitted it, the page plays that exact line using a cached Kore recording from `gemini-3.8-flash-tts` (configurable via `GEMINI_TTS_MODEL`); browser speech synthesis handles unavailable TTS access. The question is added to Live conversation history so subsequent yes/no answers refer to dancing.

## Run locally

Requires Node.js 22 or newer. Run `npm ci` to install the locked dependencies.

1. Get a Gemini API key at https://aistudio.google.com/apikey with access to a Gemini Live audio model.
2. Copy `.env.example` to `.env` and fill in `GEMINI_API_KEY` there. Keep this file private; it is excluded by `.gitignore` and the server cannot serve it.
3. Run `npm start`.
4. Open **http://localhost:3000/StepDanceHome.html**. Gemini starts automatically and requests microphone access. After permission and connection, Gemini reads the heading, description, navigation links, and Ready instruction aloud. The microphone is already listening during that introduction, so you can interrupt or reply immediately. Home shows the microphone bars while keeping coach status and conversation text hidden, with no voice buttons. Say **Ready** to open Songs or ask for another page.

Home, Songs, Practice, and Settings use the same continuous Live microphone capture and measured level bar. The bar shows **YOU SPEAKING**, **COACH SPEAKING**, **MIC LIVE**, or **CONNECTING**. Home enables the coach for this tab and subsequent page navigation reconnects it. Say **stop listening** to release the Live microphone; press **Space** to restart after stopping or a connection error. Songs, Practice, and Settings also retain their voice control buttons. Each page has its own server-validated instructions and tools. Microphone permission is requested before waiting for audio playback to unlock, avoiding a stalled automatic start. If a browser still blocks playback, tap anywhere on the page or press Space; this resumes the existing audio context without acquiring another microphone. The song list greeting, selection, music ducking, and CD artwork behavior are preserved.

The coach asks: “We are on the Song list page. Would you like me to read the available songs for you?” Say yes/no, ask questions naturally, name a song, say **play Shake It Off**, **play this song**, **stop the music**, or **Dance!**, or ask to go to the start page. You can interrupt the coach. Voice and manual selection use the same page state. Voice selection also queues background playback. Say **play the next song** or **play the previous song** to move down/up from the current selection in list order. At either end the coach lists the available choices and keeps the current song, without wrapping. The Dance button opens Practice with the selected song title and its bundled audio. The active Live coach reconnects on Practice.

The mic stays open for the whole conversation, including quiet moments and coach speech. Gemini detects the end of speech; the browser does not repeatedly start/stop recognition. Hover previews play the corresponding song while the coach is on. Say **Pause** to pause all music on the current page at its current position, cancel queued playback/autoplay, and stop hover from restarting it. The voice coach keeps listening and camera recording continues. Choose or play a song explicitly to hear music again; the Practice music note also resumes its paused track. Say **Stop** to stop the voice coach and release its microphone. Explicit voice requests play the exact song’s bundled audio after the coach’s acknowledgment; clicking a song title also starts audio; say stop the music to stop it. Song volume automatically fades down while microphone speech is detected or the coach speaks, stays low through brief pauses, and returns to normal when both are quiet. Stopping the coach also restores normal song volume. Headphones can help if your speakers cause echo.

Audio is streamed to Google while the coach is active. This local app does not save recordings or transcripts. The permanent key stays on the local server, which supplies a single-use, short-lived Live token. This server binds to localhost and is intended for local development; a public deployment needs authenticated token provisioning. Sessions end on provider disconnect or token expiration; press Space to reconnect.

## Code map

- `server.mjs`: model, voice, personality, exact greeting, allowed page tools, private token endpoint, and static server.
- `js/gemini-coach.js`: Live WebSocket, mic session, audio playback, transcriptions, interruptions, tool responses, and cleanup.
- `js/mic-worklet.js`: continuous microphone capture, downsampled to mono 16 kHz signed PCM.
- `js/songs.js`: song controls, validated selection, CD artwork, music ducking, and voice navigation.
- `js/page-coach.js`: automatic Home startup, Practice and Settings Live controls, page reading, page tools, and navigation.
- `js/music-controls.js`: pause all page music without resetting positions, cancel pending autoplay, and leave Gemini listening.
- `js/voice-ui.js` / `js/voice-ui.css`: shared microphone meter, tab conversation state, visible page reading text, and status styles.
- `songs.html`: module entry point and voice coach UI.

## Verification

Run `npm test`. Tests cover token provisioning with a mocked Google response, key protection, missing-key errors, PCM conversion, downsampling, greeting, tool handling, interruptions, deferred navigation, resource cleanup, and actual page actions. Tests also cover a missing dance question, duplicate prevention, cancellation during speech loading, fallback speech, and cached fixed-question generation. A live Gemini conversation requires your API key and microphone and is not covered by these offline tests.

References: [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api), [WebSocket protocol](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket), [ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens).
