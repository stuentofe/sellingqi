// tit.js

import fs from 'fs/promises';
import path from 'path';

export async function generateTitQuestion(passage) {
  if (!passage) {
    throw new Error('지문이 없습니다.');
  }

  const p = passage;

  const hasClaim = await fetchPrompt('tit2.txt', { p });
  let finalPassage = p;
  if (hasClaim.trim().toUpperCase() === 'NO') {
    const qraw = await fetchPrompt('tit10.txt', { p }, 'gpt-4o');
    finalPassage = qraw.trim();
  }

  // 3. 선택지 생성 (const c만 GPT-4o 모델 사용)
  const c = (await fetchPrompt('tit3.txt', { p: finalPassage }, 'gpt-4o')).trim();
  // 오답 4개를 하나의 프롬프트로 생성하고 개행으로 구분

  const wrongRaw = (await fetchPrompt('tit4.txt', { p: finalPassage, c }, 'gpt-4o')).trim();
  const wrongOptions = wrongRaw
    .split('\n')
    .map(opt => opt.trim())
    .filter(opt => opt)
    .slice(0, 4);

  // 정답 + 오답 배열 구성
  const options = [c, ...wrongOptions];
  const sorted = [...options].sort((a, b) => a.length - b.length);
  const labels = ['①','②','③','④','⑤'];
  const correctIndex = sorted.findIndex(opt => opt === c);
  const optionItems = sorted.map((opt, i) => ({ label: labels[i], text: opt }));

  // 4. 해설 생성 (const e만 GPT-4o 모델 사용)
  const e = (await fetchPrompt('tit8.txt', { p: finalPassage, c }, 'gpt-4o')).trim();
  const f = (await fetchPrompt('tit9.txt', { p: finalPassage, c })).trim();
  const answerNum = labels[correctIndex];
  const josa = ['이','가','이','가','가'][correctIndex];
  const explanation = `${e} 따라서, 글의 제목은 ${answerNum}${josa} 가장 적절하다.`;

  // 5. body 합치기: 지문 + 선택지
  const body = `
    <p>${finalPassage}</p>
    <ul>
      ${optionItems.map(item => `<li>${item.label} ${item.text}</li>`).join('')}
    </ul>
  `;

  return {
    prompt: '다음 글의 제목으로 가장 적절한 것은?',
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
