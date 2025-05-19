// pages/api/wordReplacement.js
// Vercel 배포용 API Route: 단어 교체형 문제 생성

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const { text: passage } = req.body;
  if (!passage || typeof passage !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing passage' });
  }
  try {
    const result = await generateWordReplacementProblem(passage);
    return res.status(200).json(result);
  } catch (error) {
    console.error('WordReplacement API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// RegExp 특수문자 이스케이프
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

async function generateWordReplacementProblem(passage) {
  // 1) 중요한 단어(c1) 추출
  const c1 = await fetchInlinePrompt('firstPrompt', { p: passage });
  if (!c1 || c1.trim().toLowerCase() === 'none') {
    throw new Error('중요한 단어를 추출하지 못했습니다.');
  }
  const safeC1 = escapeRegExp(c1);
let targetSentence;
try {
  const regex = new RegExp(`\\b${safeC1}\\b`, 'i'); // 'i'는 대소문자 무시
  targetSentence = sentences.find(s => regex.test(s));
} catch (err) {
  console.error('RegExp 생성 에러:', err, 'safeC1:', safeC1);
  throw new Error('정규표현식 생성 실패');
}

if (!targetSentence) {
  console.error('c1이 포함된 문장을 찾지 못함', { c1, safeC1, sentences });
  throw new Error('원문에서 c1 포함 문장을 찾을 수 없습니다.');
}

  // 2) c1의 유의어(c2) 추출
  const c2 = await fetchInlinePrompt('secondPrompt', { c1, p: passage });
  if (!c2) {
    throw new Error('유의어를 추출하지 못했습니다.');
  }

  // 문장 분할 및 c1 포함 문장 찾기
  const sentences = passage.match(/[^.!?]+[.!?]/g)?.map(s => s.trim()) || [];
  const targetSentence = sentences.find(s => new RegExp(`\\b${safeC1}\\b`).test(s));
  if (!targetSentence) {
    throw new Error('원문에서 c1 포함 문장을 찾을 수 없습니다.');
  }

  // 3) 빈칸 문장 생성 (전체 교체)
  const blankSentence = targetSentence.replace(
    new RegExp(`\\b${safeC1}\\b`, 'g'),
    '[ ]'
  );

  // 4) w1 ~ w4 생성
  const w1 = await fetchInlinePrompt('thirdPrompt', { b: blankSentence, c1 });
  const w2 = await fetchInlinePrompt('fourthPrompt', { b: blankSentence, c1, w1 });
  const w3 = await fetchInlinePrompt('fifthPrompt', { b: blankSentence, c1, w1, w2 });
  const w4 = await fetchInlinePrompt('sixthPrompt', { b: blankSentence, c1, w1, w2, w3 });

  // 선택지 구성 (c2 정답 + w1~w4 오답) 철자 개수 오름차순
  const options = [c2, w1, w2, w3, w4]
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);
  const numberedOptions = options.map((word, i) => `${i+1}. ${word}`);

  const answerIndex = options.indexOf(c2);
  if (answerIndex < 0) throw new Error('정답을 선택지에서 찾지 못했습니다.');
  const answer = (answerIndex + 1).toString();

  // 5) 빈칸 처리된 전체 지문 (글 전반 교체)
  const blankedPassage = passage.replace(
    new RegExp(`\\b${safeC1}\\b`, 'g'),
    `<${' '.repeat(10)}>`
  );

  // 6) 해설 생성
  const explanationText = await fetchInlinePrompt(
    'explanationPrompt',
    { p: blankedPassage, c2 }
  );

  return {
    prompt: '다음 글의 빈칸에 알맞은 낱말은?',
    problem: `다음 글의 빈칸에 알맞은 낱말은?\n\n${blankedPassage}`,
    choices: numberedOptions.join('\n'),
    answer,
    explanation: explanationText
  };
}

// OpenAI 호출 래퍼
async function fetchInlinePrompt(key, replacements, model = 'gpt-4o') {
  let prompt = inlinePrompts[key] || '';
  for (const k in replacements) {
    prompt = prompt.replace(new RegExp(`{{${k}}}`, 'g'), replacements[k]);
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.3 })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
}

// 프롬프트 템플릿 (별도 관리)
const inlinePrompts = {
  firstPrompt: `
Do not say in conversational form. Only output the result.
If there is a contextually very important word that is only used once in the following passage, say it.
If there isn’t, output none.
Write in lowercase and do not use punctuation.
Passage: {{p}}
  `,

  secondPrompt: `
Do not say in conversational form. Only output the result.
I’d like to replace ‘{{c1}}’ in the following passage with a contextually interchangeable word that has never been used in the passage and that is similar in its word difficulty level.
What can it be?
Write in lowercase and do not use punctuation.
Passage: {{p}}
  `,

  thirdPrompt: `
Do not say in conversational form. Only output the result.
Name a single word that can be put in the blank of the following sentence, but that when put in it creates a totally different meaning compared to when '{{c1}}' is in it.
Write in lowercase and do not use punctuation.
Sentence: {{b}}
  `,

  fourthPrompt: `
Do not say in conversational form. Only output the result.
Name a single word that can be put in the blank of the following sentence, but that when put in it creates a totally different meaning compared to when '{{c1}}' or '{{w1}}' is in it.
Write in lowercase and do not use punctuation.
Sentence: {{b}}
  `,

  fifthPrompt: `
Do not say in conversational form. Only output the result.
Name a single word that can be put in the blank of the following sentence, but that when put in it creates a totally different meaning compared to when '{{c1}}', '{{w1}}', or '{{w2}}' is in it.
Write in lowercase and do not use punctuation.
Sentence: {{b}}
  `,

  sixthPrompt: `
Do not say in conversational form. Only output the result.
Name a single word that can be put in the blank of the following sentence, but that when put in it creates a totally different meaning compared to when '{{c1}}', '{{w1}}', '{{w2}}', or '{{w3}}' is in it.
Write in lowercase and do not use punctuation.
Sentence: {{b}}
  `,

  explanationPrompt: `
Do not say in conversational form. Only output the result.
다음 지문의 빈칸에 정답 낱말이 들어가야 하는 이유를 한국어로 설명하는 해설을 작성하라.
글의 전반적 내용을 근거로 삼거나, 앞뒤 문맥을 근거로 삼고,
문체는 "~(이)다"체를 사용한다. 
지문: {{p}}
  `,
};

