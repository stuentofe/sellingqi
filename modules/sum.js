export async function generateSumQuestion(passage) {
  if (!passage) {
    throw new Error('지문이 없습니다.');
  }
  const p = passage;

 // 1. 요약문 생성 (@, # 마킹 포함)
  const s1raw = await fetchPrompt('sum1.txt', { p }, 'gpt-4o');
  console.log('📄 [sum1.txt] Raw response:', s1raw);
  const s1 = s1raw.trim();
  // @와 # 뒤 핵심 단어 c1, c2 추출
  const tags = [...s1.matchAll(/[@#]([^\s.,!]+)/g)];
  const c1 = tags[0]?.[1].trim() || '';
  const c2 = tags[1]?.[1].trim() || '';
  const c = `${c1}, ${c2}`;
  // s2: '@문자열'→'(A)', '#문자열'→'(B)'
  const s2 = s1
    .replace(/@[^^\s.,!]+/g, '(A)')
    .replace(/#[^\s.,!]+/g, '(B)');

  // 2. 오답 선택지 생성
  const wrongRaw = await fetchPrompt('sum2.txt', { p, s2, c }, 'gpt-4o');
  console.log('📄 [sum2.txt] Raw response:', wrongRaw);
  const wrongOptions = wrongRaw.trim().split('\n').map(line => line.trim()).filter(Boolean).slice(0, 4);
  const [w1, w2, x1, x2, y1, y2, z1, z2] = wrongOptions.flatMap(opt => opt.split(',').map(s => s.trim()));

  // 3. 해설 e1 생성
  const e1raw = (await fetchPrompt('sum3.txt', { p, s: s2, c }));
  console.log('📄 [sum3.txt] Raw response:', e1raw);
  const e1 = e1raw.trim();

  // 4. 한국어 번역 e2 생성 ($, % 마킹 포함)
  const e2raw = (await fetchPrompt('sum4.txt', { s: s1 }));
  console.log('📄 [sum4.txt] Raw response:', e2raw);
  let e2 = e2raw.trim()
    .replace(/\$(.*?)\$/g, (_, word) => `(A)${word}(${c1})`)
    .replace(/\%(.*?)\%/g, (_, word) => `(B)${word}(${c2})`);

  // 5. 단어별 한국어 뜻 e3 생성
  const e3raw = (await fetchPrompt('sum5.txt', { w1, w2, x1, x2, y1, y2, z1, z2 }));
  console.log('📄 [sum5.txt] Raw response:', e3raw);
  const e3 = e3raw.trim();

// 6. e3 정의 배열로 분리 및 변수 할당
  const defs = e3.split(',').map(d => d.trim());
  const [w3, w4, x3, x4, y3, y4, z3, z4] = defs;

  // 7. 최종 해설 조합
  const wrongList = [
    `${w1}(${w3})`, `${w2}(${w4})`, `${x1}(${x3})`, `${x2}(${x4})`, `${y1}(${y3})`, `${y2}(${y4})`, `${z1}(${z3})`, `${z2}(${z4})`,
  ].join(', ');
  const explanation = `${e1} 따라서 요약문이 '${e2}'가 되도록 완성해야 한다. [오답] ${wrongList}`;

  const s3 = s2.replace(/\(A\)/g, '<u>___(A)___</u>').replace(/\(B\)/g, '<u>___(B)___</u>');

  // 본문(body) 구성
  const body = `
    <div class="box"><p>${p}</p></div>
    <p style="text-align:center">↓</p>
    <div class="box"><p>${s3}</p></div>
    <ul>
      <li>① ${c}</li>
      ${wrongOptions.map((opt, i) => `<li>${['②','③','④','⑤'][i]} ${opt}</li>`).join('')}
    </ul>
      `;

  return {
    prompt: '다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 가장 적절한 것은?',
    body,
    answer: '①',
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
