I am # Step Dance — Gemini voice coach (song page / part 5)

The song page uses Gemini Live for **audio understanding, transcription, conversation, and generated speech**. Browser `SpeechRecognition` is not used. Gemini Live supplies conversational speech; browser speech synthesis is a fallback only for the mandatory dance question if Gemini TTS is unavailable. The default model is `gemini-3.8-live`, with the **Kore** voice and an enthusiastic, patient dance coach instruction. The model can be overridden in `.env` if your Gemini project uses a different Live audio model. After selection, the client checks the actual generated transcript for “Do you want to dance to it?”. If Live omitted it, the page plays that exact line using a cached Kore recording from `gemini-3.8-flash-tts` (configurable via `GEMINI_TTS_MODEL`); browser speech synthesis handles unavailable TTS access. The question is added to Live conversation history so subsequent yes/no answers refer to dancing.

## Run locally

Requires Node.js 22 or newer. There are no packages to install.

1. Get a Gemini API key at https://aistudio.google.com/apikey with access to a Gemini Live audio model.
2. Copy `.env.example` to `.env` and fill in `GEMINI_API_KEY` there. Keep this file private; it is excluded by `.gitignore` and the server cannot serve it.
3. Run `npm start`.
4. Open **http://localhost:3000/songs.html** in a modern browser, press **Space** or click the **Start voice coach** button at the top, and allow microphone access. Both the start page and song page announce “Press space bar to start the voice coach” using browser speech when autoplay is allowed, and display the hint. On the start page, Space opens the song page with a one-time coach-start intent. On the song page it starts directly. If the browser blocks audio after navigation, press Space again to unlock it. Opening the HTML directly or using a separate static server will not provide the Gemini token endpoint.

The coach asks: “We are on the Song list page. Would you like me to read the available songs for you?” Say yes/no, ask questions naturally, name a song, say **play Shake It Off**, **play this song**, **stop the music**, or **Dance!**, or ask to go to the start page. You can interrupt the coach. Voice and manual selection use the same page state. Voice selection also queues background playback. Say **play the next song** or **play the previous song** to move down/up from the current selection in list order. At either end the coach lists the available choices and keeps the current song, without wrapping. The Dance button is clicked when requested, but the unfinished dance page remains a placeholder.

The mic stays open for the whole conversation, including quiet moments and coach speech. Gemini detects the end of speech; the browser does not repeatedly start/stop recognition. Automatic hover previews pause while the coach is on. Explicit voice requests play the exact song’s bundled audio after the coach’s acknowledgment; Clicking a song title also starts audio; say stop the music to stop it. Song volume automatically fades down while microphone speech is detected or the coach speaks, stays low through brief pauses, and returns to normal when both are quiet. Stopping the coach also restores normal song volume. Stop the coach to release the mic. Headphones can help if your speakers cause echo.

Audio is streamed to Google while the coach is active. This local app does not save recordings or transcripts. The permanent key stays on the local server, which supplies a single-use, short-lived Live token. This server binds to localhost and is intended for local development; a public deployment needs authenticated token provisioning. Sessions end on provider disconnect or token expiration; tap Start to reconnect.

## Code map

- `server.mjs`: model, voice, personality, exact greeting, allowed page tools, private token endpoint, and static server.
- `js/gemini-coach.js`: Live WebSocket, mic session, audio playback, transcriptions, interruptions, tool responses, and cleanup.
- `js/mic-worklet.js`: continuous microphone capture, downsampled to mono 16 kHz signed PCM.
- `js/songs.js`: page controls, waveform, validated song selection, actual Dance button click, and deferred home navigation.
- `songs.html`: module entry point and voice coach UI.

## Verification

Run `npm test`. Tests cover token provisioning with a mocked Google response, key protection, missing-key errors, PCM conversion, downsampling, greeting, tool handling, interruptions, deferred navigation, resource cleanup, and actual page actions. Tests also cover a missing dance question, duplicate prevention, cancellation during speech loading, fallback speech, and cached fixed-question generation. A live Gemini conversation requires your API key and microphone and is not covered by these offline tests.

References: [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api), [WebSocket protocol](https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket), [ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens).
