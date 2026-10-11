# Step Dance

Step Dance teaches you to dance by voice. An AI coach talks you through every move, so anyone can learn without watching a screen. Built by Team Step Dance for HackNC 2026.

- Live site: [stepdances.tech](https://www.stepdances.tech)
- Demo video: [stepdances.tech/demo](https://www.stepdances.tech/demo)

## Inspiration
Almost every dance tutorial online assumes you can watch a screen and copy what you see. That leaves out people who are blind or have low vision, and it isn't much help to anyone dancing across the room from their laptop. Classes cost money, and trying something new in front of strangers is scary.

We wanted learning to dance to feel like having a patient friend in the room who never judges your moves. And we wanted it to look like pure joy, so we went all in on the Frutiger Aero theme with blue skies, glossy bubbles, drifting clouds, and swimming fish.

## What it does
Step Dance is a free dance practice site you can use with your voice and your ears.

- **Talk to your coach.** Press the space bar and a voice coach greets you, reads out the song list, and plays the one you pick. Ask it questions, interrupt it, or just say "Dance!".
- **Practice on camera.** The coach looks at your moves through the webcam and calls out simple cues such as "Lift your arms higher" or "Move more to the left".
- **Hear it in a human voice.** Feedback is spoken in a warm, natural voice.
- **See your skeleton.** Record a practice and the computer vision backend sends it back with your pose drawn over it.
- **Keep your progress.** Every practice session is logged, and you can save a "practice complete" record on Solana from your own wallet.

## How we built it
- **Gemini API:** a live, two-way voice conversation for the song-page coach, and image understanding that turns webcam snapshots into short cues on the practice page
- **ElevenLabs:** the spoken voice for cues and encouragement
- **Computer vision:** MediaPipe pose tracking in a Python Flask backend (`backend/`)
- **Tiger Data:** a time-series log of practice sessions
- **Solana:** a practice record saved on devnet through the Phantom wallet
- **Frontend:** hand-written HTML, CSS, and JavaScript
- **Hosting:** Vercel, on a .tech domain

## Run it locally
Requires Node.js 22 or newer.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and fill in your keys. Each key switches on one feature; the pages load without any of them.
3. Run `npm start`.
4. Open http://localhost:3000/StepDanceHome.html and allow the microphone and camera when asked.

The song-page voice coach only runs through this local server. See [VOICE-COACH.md](VOICE-COACH.md) for how it works. Run the tests with `npm test`.

## Citations

### AI assistance
- Service endpoints for ElevenLabs, Tiger Data, Snowflake, and the Gemini camera coach (`api/`): Claude Code
- Practice-page camera coach (`js/practice-coach.js`): Claude Code
- Demo page (`demo.html`) and Vercel configuration (`vercel.json`): Claude Code
- Small edits to `server.mjs`, `read-aloud.js`, `practice.html`, `settings.html`, and `js/songs.js`: Claude Code
- Pose-drawing speed optimisation in `backend/test_dance_v2.py`: Gemini
- [VOICE-COACH.md](VOICE-COACH.md): created with assistance from AI
- Drafting this README and our Devpost write-up: Claude Code

We used AI to write first versions of the service integrations, to debug, and to draft documentation. We reviewed and tested the code and changed it as we needed.

### Code sources
- Webcam recording: https://dev.to/koolkamalkishor/recording-videos-using-javascript-and-browser-apis-302k
- Pose tracking: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/python and https://github.com/google-ai-edge/mediapipe-samples/tree/main/examples/pose_landmarker/python
- File uploads in Flask: https://flask.palletsprojects.com/en/stable/patterns/fileuploads/

### Music and artwork
- "World Is Mine" by ryo (supercell), performed by Hatsune Miku
- "Shake It Off" by Taylor Swift
- "Tell Your World" by livetune, performed by Hatsune Miku
- Background: the Windows XP "Bliss" wallpaper, owned by Microsoft

Songs, album art, fonts, and images belong to their respective owners and are used here for a student hackathon demo.
