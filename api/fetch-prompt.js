export default async function handler(req, res) {
  const { prompt, model = 'gpt-3.5-turbo' } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'API key not found' });
  }

  try {
    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    });

    const data = await gptRes.json();
    res.status(200).json({ result: data.choices[0].message.content.trim() });
  } catch (err) {
    res.status(500).json({ error: 'GPT request failed' });
  }
}
