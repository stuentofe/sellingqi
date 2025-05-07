// top.js

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
    const result = await generateTopQuestion(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('top API error:', error);
    res.status(500).json({ error: 'Failed to generate topic question' });
  }
}

export async function generateTopQuestion(passage) {
  if (!passage) {
    throw new Error('지문이 없습니다.');
  }

  const p = passage;

  const hasClaim = await fetchPrompt('top2.txt', { p });
  let finalPassage = p;
  if (hasClaim.trim().toUpperCase() === 'NO') {
    const qraw = await fetchPrompt('top10.txt', { p }, 'gpt-4o');
    finalPassage = qraw.trim();
  }

  // 3. 선택지 생성 (const c만 GPT-4o 모델 사용)
  const c = (await fetchPrompt('top3.txt', { p: finalPassage }, 'gpt-4o')).trim();
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
  if (correctIndex === -1) throw new Error('정답 위치를 찾을 수 없습니다.');

  const optionItems = sorted.map((opt, i) => ({ label: labels[i], text: opt }));

  // 4. 해설 생성 (const e만 GPT-4o 모델 사용)
  const e = (await fetchPrompt('top8.txt', { p: finalPassage, c }, 'gpt-4o')).trim();
  const f = (await fetchPrompt('top9.txt', { p: finalPassage, c })).trim();
  const answerNum = labels[correctIndex];
  const josa = ['이','가','이','가','가'][correctIndex];
  const explanation = `${e} 따라서, 글의 주제는 ${answerNum}${josa} 가장 적절하다.`;

  // 5. body 합치기: 지문 + 선택지
  const body = `
    <p>${finalPassage}</p>
    <ul>
      ${optionItems.map(item => `<li>${item.label} ${item.text}</li>`).join('')}
    </ul>
  `;

  return {
    prompt: '다음 글의 주제로 가장 적절한 것은?',
    body,
    answer: answerNum,
    explanation
  };
}

/**
 * fetchPrompt: prompts 파일을 로컬에서 읽고 OpenAI API로 직접 요청
 * @param {string} file - prompts 디렉터리 내 파일명
 * @param {object} replacements - 프롬프트 내 치환용 키-값 객체
 * @param {string} model - 사용할 OpenAI 모델 (기본: gpt-3.5-turbo)
 */
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
