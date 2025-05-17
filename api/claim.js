// 경로: api/clm.js

import fs from 'fs/promises';
import path from 'path';

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
    const hasClaim = await fetchPrompt('clm2.txt', { p });
    let finalPassage = p;

    if (hasClaim.trim().toUpperCase() === 'NO') {
      const qraw = await fetchPrompt('clm5.txt', { p });
      finalPassage = qraw.trim();
    }

    // 2. 선택지 생성
    const c = (await fetchPrompt('clm3-1.txt', { p: finalPassage }, 'gpt-4o')).trim();
    const w = (await fetchPrompt('clm3-2-w.txt', { p: finalPassage, c })).trim();
    const x = (await fetchPrompt('clm3-2-x.txt', { p: finalPassage, c, w })).trim();
    const y = (await fetchPrompt('clm3-3-y.txt', { p: finalPassage, c, w, x })).trim();
    const z = (await fetchPrompt('clm3-3-z.txt', { p: finalPassage, c, w, x, y })).trim();

    const options = [c, w, x, y, z];
    const sorted = [...options].sort((a, b) => a.length - b.length);
    const labels = ['①','②','③','④','⑤'];
    const correctIndex = sorted.findIndex(opt => opt.trim() === c.trim());
    const optionItems = sorted.map((opt, i) => ({ label: labels[i], text: opt }));

    // 3. 해설 생성
    const e = (await fetchPrompt('clm3-5-e.txt', { p: finalPassage, c })).trim();
    const f = (await fetchPrompt('clm3-5-f.txt', { p: finalPassage, c })).trim();
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

async function fetchPrompt(file, replacements, model = 'gpt-3.5-turbo') {
  const filePath = path.join(process.cwd(), 'api', 'prompts', file);
  let prompt = await fs.readFile(filePath, 'utf-8');

  for (const key in replacements) {
    prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), replacements[key]);
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
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

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'GPT 응답 실패');
  return data.choices[0].message.content.trim();
}
