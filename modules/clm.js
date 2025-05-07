// clm.js

export async function generateClaimQuestion(passage) {
  if (!passage) {
    throw new Error('지문이 없습니다.');
  }

  const p = passage;

  // 2. 주장 문장 존재 여부
  const hasClaim = await fetchPrompt('clm2.txt', { p });
  let finalPassage = p;
  if (hasClaim === 'NO') {
    const qraw = await fetchPrompt('clm5.txt', { p });
    finalPassage = qraw.trim();
  }

  // 3. 선택지 생성 (const c만 GPT-4o 모델 사용)
  const c = (await fetchPrompt('clm3-1.txt', { p: finalPassage }, 'gpt-4o')).trim();
  const w = (await fetchPrompt('clm3-2-w.txt', { p: finalPassage, c })).trim();
  const x = (await fetchPrompt('clm3-2-x.txt', { p: finalPassage, c, w })).trim();
  const y = (await fetchPrompt('clm3-3-y.txt', { p: finalPassage, c, w, x })).trim();
  const z = (await fetchPrompt('clm3-3-z.txt', { p: finalPassage, c, w, x, y })).trim();

  const options = [c, w, x, y, z];
  const sorted = [...options].sort((a, b) => a.length - b.length);
  const labels = ['①','②','③','④','⑤'];
  const correctIndex = sorted.findIndex(opt => opt === c);
  const optionItems = sorted.map((opt, i) => ({ label: labels[i], text: opt }));

  // 4. 해설 생성
  const e = (await fetchPrompt('clm3-5-e.txt', { p: finalPassage, c })).trim();
  const f = (await fetchPrompt('clm3-5-f.txt', { p: finalPassage, c })).trim();
  const answerNum = labels[correctIndex];
  const josa = ['이','가','이','가','가'][correctIndex];
  const explanation = `${e} 필자의 주장은, 문장 ${f}에서 가장 명시적으로 드러난다. 따라서, 글의 주장으로는 ${answerNum}${josa} 가장 적절하다.`;

  // 5. body 합치기: 지문 + 선택지
  const body = `
    <p>${finalPassage}</p>
    <ul>
      ${optionItems.map(item => `<li>${item.label} ${item.text}</li>`).join('')}
    </ul>
  `;

  return {
    prompt: '다음 글에서 필자가 주장하는 것으로 가장 적절한 것은?',
    body,
    answer: answerNum,
    explanation
  };
}

/**
 * fetchPrompt: prompts 파일을 불러와 OpenAI API로 요청
 * @param {string} file - prompts 디렉터리 내 파일명
 * @param {object} replacements - 프롬프트 내 치환용 키-값 객체
 * @param {string} model - 사용할 OpenAI 모델 (기본: gpt-3.5-turbo)
 */
async function fetchPrompt(file, replacements, model = 'gpt-3.5-turbo') {
  const prompt = await fetch(`/prompts/${file}`).then(res => res.text());
  let fullPrompt = prompt;
  for (const key in replacements) {
    fullPrompt = fullPrompt.replace(new RegExp(`{{${key}}}`, 'g'), replacements[key]);
  }

const response = await fetch('/api/fetch-prompt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: fullPrompt, model })
});

const data = await response.json();
if (data.error) throw new Error(data.error);
return data.result;

}
