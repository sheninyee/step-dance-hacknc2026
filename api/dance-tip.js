// Gemini vision: POST /api/dance-tip with { image: base64 JPEG } returns one short dance instruction.
const prompt = `You are a friendly dance coach watching one webcam frame of a learner practicing a simple routine.
Reply with exactly one short spoken instruction of at most eight words, such as "Lift your arms higher", "Lower your arms",
"Go a little quicker", "Slow down a little", "Move more to the left", or "Move more to the right".
If no person is visible, reply "Step into the camera view".`;
export default async function handler(req, res) {
  // Vercel parses the JSON body; the local server reads it from the request stream.
  const { image } = req.body ?? JSON.parse(Buffer.concat(await Array.fromAsync(req)).toString());
  const model = process.env.GEMINI_COACH_MODEL || 'gemini-3.5-flash-lite';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: image } }, { text: prompt }] }] })
  });
  const tip = (await response.json()).candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!tip) { res.writeHead(502); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ tip }));
}
