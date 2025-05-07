// 경로: api/clm.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { passage } = req.body;
  if (!passage || typeof passage !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing passage' });
  }

  try {
    const p = passage;

    // 1. 주장 문장 존재 여부 확인
    const hasClaim = await callPrompt('clm2.txt', { p });
    let finalPassage = p;

    if (hasClaim === 'NO') {
      const qraw = await callPrompt('clm5.txt', { p });
      finalPassage = qraw.trim();
    }

    // 2. 선택지 생성
    const c = (await callPrompt('clm3-1.txt', { p: finalPassage }, 'gpt-4o')).trim();
    const w = (await callPrompt('clm3-2-w.txt', { p: finalPassage, c })).trim();
    const x = (await callPrompt('clm3-2-x.txt', { p: finalPassage, c, w })).trim();
    const y = (await callPrompt('clm3-3-y.txt', { p: finalPassage, c, w, x })).trim();
    const z = (await callPrompt('clm3-3-z.txt', { p: finalPassage, c, w, x, y })).trim();

    const options = [c, w, x, y, z];
    const sorted = [...options].sort((a, b) => a.length - b.length);
    const labels = ['①','②','③','④','⑤'];
    const correctIndex = sorted.findIndex(opt => opt === c);
    const optionItems = sorted.map((opt, i) => ({ label: labels[i], text: opt }));

    // 3. 해설 생성
    const e = (await callPrompt('clm3-5-e.txt', { p: finalPassage, c })).trim();
    const f = (await callPrompt('clm3-5-f.txt', { p: finalPassage, c })).trim();
    const answerNum = labels[correctIndex];
    const josa = ['이','가','이','가','가'][correctIndex];
    const explanation = `${e} 필자의 주장은, 문장 ${f}에서 가장 명시적으로 드러난다. 따라서, 글의 주장으로는 ${answerNum}${josa} 가장 적절하다.`;

    // 4. body 조립
    const body = `
      <p>${finalPassage}</p>
      <ul>
        ${optionItems.map(item => `<li>${item.label} ${item.text}</li>`).join('')}
      </ul>
    `;

    res.status(200).json({
      prompt: '다음 글에서 필자가 주장하는 것으로 가장 적절한 것은?',
      body,
      answer: answerNum,
      explanation
    });

  } catch (err) {
    console.error('clm API error:', err);
    res.status(500).json({ error: 'Failed to generate claim question' });
  }
}

async function callPrompt(promptFile, replacements, model = 'gpt-3.5-turbo') {
  const res = await fetch('http://localhost:3000/api/fetch-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ promptFile, replacements, model })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}
