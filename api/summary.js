import fs from 'fs/promises';
import path from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text: passage } = req.body;
  if (!passage || typeof passage !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing passage' });
  }

  try {
    const result = await generateSumQuestion(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('summary API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate summary question' });
  }
}

async function generateSumQuestion(passage) {
  const p = passage;

  // 1단계: 요약문 생성
  const s1 = (await fetchPrompt('sum1.txt', { p }, 'gpt-4o')).trim();
  const tags = [...s1.matchAll(/[@#]([^\s.,!]+)/g)];
  const c1 = tags[0]?.[1]?.trim() || '';
  const c2 = tags[1]?.[1]?.trim() || '';
  const c = `${c1}, ${c2}`;

  const s2 = s1
    .replace(/@[^\s.,!]+/g, '(A)')
    .replace(/#[^\s.,!]+/g, '(B)');

  // 2단계: 오답 생성
  const wrongRaw = await fetchPrompt('sum2.txt', { p, s2, c }, 'gpt-4o');
  const wrongOptions = wrongRaw.trim().split('\n').map(line => line.trim()).filter(Boolean).slice(0, 4);
  const [w1, w2, x1, x2, y1, y2, z1, z2] = wrongOptions.flatMap(opt => opt.split(',').map(s => s.trim()));

  const allOptions = [
    { text: `${c1}, ${c2}`, key: '정답', len: c1.length + c2.length },
    { text: `${w1}, ${w2}`, key: 'w', len: w1.length + w2.length },
    { text: `${x1}, ${x2}`, key: 'x', len: x1.length + x2.length },
    { text: `${y1}, ${y2}`, key: 'y', len: y1.length + y2.length },
    { text: `${z1}, ${z2}`, key: 'z', len: z1.length + z2.length },
  ];

  allOptions.sort((a, b) => a.len - b.len);

  const labels = ['①', '②', '③', '④', '⑤'];
  const choices = allOptions.map((opt, idx) => ({
    no: labels[idx],
    text: opt.text
  }));

  const correct = choices.find(choice => choice.text === `${c1}, ${c2}`)?.no || '①';

  // 3단계: 해설 생성
  const e1 = (await fetchPrompt('sum3.txt', { p, s: s2, c })).trim();
  const e2 = (await fetchPrompt('sum4.txt', { s: s1 })).trim()
    .replace(/\$(.*?)\$/g, (_, word) => `(A)${word}(${c1})`)
    .replace(/\%(.*?)\%/g, (_, word) => `(B)${word}(${c2})`);
  const e3 = (await fetchPrompt('sum5.txt', { w1, w2, x1, x2, y1, y2, z1, z2 })).trim();

  const defs = e3.split(',').map(d => d.trim());
  const [w3, w4, x3, x4, y3, y4, z3, z4] = defs;

  const wrongList = [
    `${w1}(${w3})`, `${w2}(${w4})`, `${x1}(${x3})`, `${x2}(${x4})`,
    `${y1}(${y3})`, `${y2}(${y4})`, `${z1}(${z3})`, `${z2}(${z4})`,
  ].join(', ');

  const explanation =
`정답: ${correct}
${e1} 따라서 요약문이 '${e2}'가 되도록 완성해야 한다. [오답] ${wrongList}`;

  // 문제 출력 텍스트 조립
  const dot = '\u2026\u2026';
  const headerLine = `     (A)          (B)`; // 공백 포함
  const choiceLines = choices.map(choice => {
    const [a, b] = choice.text.split(',').map(s => s.trim());
    return `${choice.no} ${a}${dot}${b}`;
  }).join('\n');

  const problem =
`다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 가장 적절한 것은?

${p.trim()}

요약문:
${s2.replace(/\(A\)/g, '___(A)___').replace(/\(B\)/g, '___(B)___')}

${headerLine}
${choiceLines}`;

  return {
    prompt: '다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 가장 적절한 것은?',
    problem,
    answer: correct,
    explanation
  };
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
