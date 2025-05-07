// mni.js

import fs from 'fs/promises';
import path from 'path';

export async function generateMniQuestion(passage) {
  if (!passage) {
    throw new Error('지문이 없습니다.');
  }

  const p = passage;

  const hasClaim = await fetchPrompt('mni2.txt', { p });
  let finalPassage = p;
  if (hasClaim.trim().toUpperCase() === 'NO') {
    const qraw = await fetchPrompt('mni10.txt', { p });
    finalPassage = qraw.trim();
  }

  // 3. 선택지 생성 (const c만 GPT-4o 모델 사용)
  const c = (await fetchPrompt('mni3.txt', { p: finalPassage }, 'gpt-4o')).trim();
  const w = (await fetchPrompt('mni4.txt', { p: finalPassage, c })).trim();
  const x = (await fetchPrompt('mni5.txt', { p: finalPassage, c, w })).trim();
  const y = (await fetchPrompt('mni6.txt', { p: finalPassage, c, w, x })).trim();
  const z = (await fetchPrompt('mni7.txt', { p: finalPassage, c, w, x, y })).trim();

  const options = [c, w, x, y, z];
  const sorted = [...options].sort((a, b) => a.length - b.length);
  const labels = ['①','②','③','④','⑤'];
  const correctIndex = sorted.findIndex(opt => opt === c);
  const optionItems = sorted.map((opt, i) => ({ label: labels[i], text: opt }));

  // 4. 해설 생성
  const e = (await fetchPrompt('mni8.txt', { p: finalPassage, c })).trim();
  const f = (await fetchPrompt('mni9.txt', { p: finalPassage, c })).trim();
  const answerNum = labels[correctIndex];
  const josa = ['이','가','이','가','가'][correctIndex];
  const explanation = `${e} 글의 요지는, 문장 ${f}에서 가장 명시적으로 드러난다. 따라서, 글의 요지는 ${answerNum}${josa} 가장 적절하다.`;

  // 5. body 합치기: 지문 + 선택지
  const body = `
    <p>${finalPassage}</p>
    <ul>
      ${optionItems.map(item => `<li>${item.label} ${item.text}</li>`).join('')}
    </ul>
  `;

  return {
    prompt: '다음 글의 요지로 가장 적절한 것은?',
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
