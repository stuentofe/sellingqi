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
    const result = await generateTopQuestion(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('top API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate topic question' });
  }
}

async function generateTopQuestion(passage) {
  const p = passage;

  const hasClaim = await fetchPrompt('top2.txt', { p });
  let finalPassage = p;

  if (hasClaim.trim().toUpperCase() === 'NO') {
    const qraw = await fetchPrompt('top10.txt', { p });
    finalPassage = qraw.trim();
  }

  const c = (await fetchPrompt('top3.txt', { p: finalPassage })).trim();
  const wrongRaw = (await fetchPrompt('top4.txt', { p: finalPassage, c }, 'gpt-4o')).trim();

  const wrongOptions = wrongRaw
    .split('\n')
    .map(opt => opt.trim())
    .filter(opt => opt)
    .slice(0, 4);

  const options = [c, ...wrongOptions];
  const sorted = [...options].sort((a, b) => a.length - b.length);
  const labels = ['①','②','③','④','⑤'];
  const correctIndex = sorted.findIndex(opt => opt.trim() === c.trim());

  if (correctIndex === -1) {
    throw new Error('정답 위치를 찾을 수 없습니다. (정답이 선택지에 없음)');
  }

  const optionItems = sorted.map((opt, i) => `${labels[i]} ${opt}`);
  const answerNum = labels[correctIndex];
  const josa = ['이','가','이','가','가'][correctIndex];

  const e = (await fetchPrompt('top8.txt', { p: finalPassage, c })).trim();
  const f = (await fetchPrompt('top9.txt', { p: finalPassage, c })).trim();
  const explanationText = `${e} 따라서, 글의 주제는 ${answerNum}${josa} 가장 적절하다. [정답 해석] ${answerNum} ${translatedc};

  const problem =
`다음 글의 주제로 가장 적절한 것은?

${finalPassage.trim()}

${optionItems.join('\n')}`;

  const explanation =
`정답: ${answerNum}
${explanationText}`;

  return {
    prompt: '다음 글의 주제로 가장 적절한 것은?',
    problem,
    answer: answerNum,
    explanation
  };
}

async function fetchPrompt(file, replacements, model = 'gpt-4o') {
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
      model: "gpt-4o",
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'GPT 응답 실패');
  return data.choices[0].message.content.trim();
}
