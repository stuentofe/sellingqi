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
    const result = await generateSumQuestion(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('sum API error:', error);
    res.status(500).json({ error: 'Failed to generate summary question' });
  }
}

async function generateSumQuestion(passage) {
  if (!passage) throw new Error('지문이 없습니다.');
  const p = passage;

  // 1단계: 요약문 생성
  const s1raw = await fetchPrompt('sum1.txt', { p }, 'gpt-4o');
  const s1 = s1raw.trim();

  // 핵심어 태그 추출
  const tags = [...s1.matchAll(/[@#]([^\s.,!]+)/g)];
  const c1 = tags[0]?.[1].trim() || '';
  const c2 = tags[1]?.[1].trim() || '';
  const c = `${c1}, ${c2}`;

  // 정답 공란 처리
  const s2 = s1
    .replace(/@[^\s.,!]+/g, '(A)')
    .replace(/#[^\s.,!]+/g, '(B)');

  // 2단계: 오답 후보 생성
  const wrongRaw = await fetchPrompt('sum2.txt', { p, s2, c }, 'gpt-4o');
  const wrongOptions = wrongRaw.trim().split('\n').map(line => line.trim()).filter(Boolean).slice(0, 4);
  const [w1, w2, x1, x2, y1, y2, z1, z2] = wrongOptions.flatMap(opt => opt.split(',').map(s => s.trim()));

  // (A) 정답 후보 + 오답 4개 정렬
  const allOptions = [
    { text: c1, label: '정답' },
    { text: w1, label: 'w1' },
    { text: x1, label: 'x1' },
    { text: y1, label: 'y1' },
    { text: z1, label: 'z1' },
  ];

  allOptions.sort((a, b) => a.text.length - b.text.length);

  const choices = allOptions.map((opt, idx) => ({
    no: ['①', '②', '③', '④', '⑤'][idx],
    text: opt.text,
  }));

  const correct = choices.find(choice => choice.text === c1)?.no || '①';

  // s3는 여기서 정의돼야 body에서 사용할 수 있음
  const s3 = s2.replace(/\(A\)/g, '<u>___(A)___</u>').replace(/\(B\)/g, '<u>___(B)___</u>');

  // HTML 구성
  const body = `
    <div class="box"><p>${p}</p></div>
    <p style="text-align:center">↓</p>
    <div class="box"><p>${s3}</p></div>
    <ul>
      ${choices.map(choice => `<li>${choice.no} ${choice.text}</li>`).join('\n')}
    </ul>
  `;

  // 3단계: 해설 구성
  const e1raw = await fetchPrompt('sum3.txt', { p, s: s2, c });
  const e1 = e1raw.trim();

  const e2raw = await fetchPrompt('sum4.txt', { s: s1 });
  const e2 = e2raw.trim()
    .replace(/\$(.*?)\$/g, (_, word) => `(A)${word}(${c1})`)
    .replace(/\%(.*?)\%/g, (_, word) => `(B)${word}(${c2})`);

  const e3raw = await fetchPrompt('sum5.txt', { w1, w2, x1, x2, y1, y2, z1, z2 });
  const e3 = e3raw.trim();
  const defs = e3.split(',').map(d => d.trim());
  const [w3, w4, x3, x4, y3, y4, z3, z4] = defs;

  const wrongList = [
    `${w1}(${w3})`, `${w2}(${w4})`, `${x1}(${x3})`, `${x2}(${x4})`,
    `${y1}(${y3})`, `${y2}(${y4})`, `${z1}(${z3})`, `${z2}(${z4})`,
  ].join(', ');

  const explanation = `${e1} 따라서 요약문이 '${e2}'가 되도록 완성해야 한다. [오답] ${wrongList}`;

  return {
    prompt: '다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 가장 적절한 것은?',
    body,
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
