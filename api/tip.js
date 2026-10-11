// Snowflake Cortex REST API: GET /api/tip?count=N returns a one-sentence encouragement from an LLM.
export default async function handler(req, res) {
  const count = Number(new URL(req.url, 'http://localhost').searchParams.get('count')) || 1;
  const response = await fetch(`https://${process.env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex/inference:complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SNOWFLAKE_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ model: 'llama3.1-8b', stream: true, messages: [{ role: 'user', content: `In one short sentence, cheer on a dancer who just finished practice session number ${count}.` }] })
  });
  if (!response.ok) { res.writeHead(502); return res.end(); }
  // The reply is streamed as "data: {json}" lines; join the text pieces into one sentence.
  const tip = (await response.text()).split('\n').filter(line => line.startsWith('data: {'))
    .map(line => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '').join('').trim();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ tip }));
}
