// ElevenLabs text-to-speech: GET /api/speak?text=... returns MP3 audio.
export default async function handler(req, res) {
  const text = new URL(req.url, 'http://localhost').searchParams.get('text')?.slice(0, 300);
  const voice = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const speech = text && await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!speech?.ok) { res.writeHead(502); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
  res.end(Buffer.from(await speech.arrayBuffer()));
}
