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
    const result = await generateBlankcProblem(passage);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Blankc API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// RegExp 특수문자 이스케이프
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

async function generateBlankcProblem(passage) {
  const rawSentences = passage.match(/[^.!?]+[.!?]/g)?.map(s => s.trim()) || [];
  const indexedSentences = rawSentences.map((text, id) => ({ id, text }));

let c1 = await fetchInlinePrompt('firstPrompt', { p: passage });
if (!c1 || c1.toLowerCase() === 'none') {
  throw new Error('중요한 어구를 추출하지 못했습니다.');
}

// 앞 단어 제거 GPT 처리
c1 = await fetchInlinePrompt('trimVerbThatPrompt', { c1 });


  const safeC1 = escapeRegExp(c1.toLowerCase());

const targetEntries = indexedSentences.filter(({ text }) =>
  text.toLowerCase().match(new RegExp(`\\b${safeC1}\\b`))
);

if (targetEntries.length === 0) {
  throw new Error('원문에서 c1 포함 문장을 찾을 수 없습니다.');
}

// reference words 추출 및 개별 변수 선언
const uniqueWords = [...new Set(
  passage.toLowerCase().match(/\b[a-zA-Z]{4,}\b/g)
)];
const longestWords = uniqueWords.sort((a, b) => b.length - a.length).slice(0, 8);

// 개별 변수 할당
const [r1, r2, r3, r4, r5, r6, r7, r8] = longestWords;


// 가장 나중에 등장한 문장(id가 가장 큰 것)
const targetSentence = targetEntries.reduce((a, b) => (a.id > b.id ? a : b)).text;


  const c2 = await fetchInlinePrompt('secondPrompt', { c1, p: passage });
  if (!c2) {
    throw new Error('paraphrase에 실패했습니다.');
  }

  const blankSentence = targetSentence.replace(
    new RegExp(`\\b${safeC1}\\b`, 'g'),
    '[ ]'
  );

  const w1 = await fetchInlinePrompt('thirdPrompt', { b: blankSentence, c1, c2, r1, r8 });
  const w2 = await fetchInlinePrompt('fourthPrompt', { b: blankSentence, r2, r7, c1, c2, w1 });
  const w3 = await fetchInlinePrompt('fifthPrompt', { b: blankSentence, r3, r6, c1, c2, w1, w2 });
  const w4 = await fetchInlinePrompt('sixthPrompt', { b: blankSentence, r4, r5, c1, c2, w1, w2, w3 });

  const options = [c2, w1, w2, w3, w4].filter(Boolean).sort((a, b) => a.length - b.length);


const blankedPassage = passage.replace(
  new RegExp(`\\b${safeC1}\\b`, 'i'), // 'g' 제거 → 첫 1개만 매칭
  `<${' '.repeat(10)}>`
);


const numberSymbols = ['①', '②', '③', '④', '⑤'];
const numberedOptions = options.map((word, i) => `${numberSymbols[i]} ${word}`).join('\n');

const answerIndex = options.indexOf(c2);
if (answerIndex < 0) throw new Error('정답을 선택지에서 찾지 못했습니다.');
const answer = numberSymbols[answerIndex];

const explanationText = await fetchInlinePrompt('explanationPrompt', { p: blankedPassage, c2 });
const explanation = `정답: ${answer}\n${explanationText}`;

return {
  problem: `다음 빈칸에 들어갈 말로 가장 적절한 것은?\n\n${blankedPassage}\n\n${numberedOptions}`,
  answer,
  explanation
};
}

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

const inlinePrompts = {
  firstPrompt: `
You are part of a english question item developing system. Do not say in conversational form.

Find a contextually meaningful phrase in the following passage which consists of seven to fifteen words in one of the following grammatical categories: a verb phrase, or a subordinate clause (not the whole sentence). Never choose a phrase that contains a comma.

When you write your answer, do not include the initial subordinating conjunction, not "to" in front of an infinitive.

Write your answer in lowercase and do not use any punctuation.
Passage: {{p}}
  `,
  secondPrompt: `
Do not say in conversational form. Only output the result.
I’d like to paraphrase ‘{{c1}}’ in the following passage with a new phrase of similar length. Recommend one that fits grammatically in place of '{{c1}}'. But make sure your recommendation uses different words and sturctures.
Write in lowercase and do not use punctuation.
Passage: {{p}}
  `,
  thirdPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence using both '{{r1}}' and '{{r8}}'. Make sure your suggestion is also similar in its length to '{{c2}}'. If you can't come up with one, it's okay to use only one of the two words.

Make sure that when your suggestion is put in the blank, it creates a totally different meaning compared to when '{{c1}}' or '{{c2}}' is in it. 

Write in lowercase and do not use punctuation. Do not repeat the whole sentence, and only ouput the part that fills the blank.
Sentence: {{b}}
  `,
  fourthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence using both '{{r2}}' and '{{r7}}'. Make sure your suggestion is also similar in its length to '{{c2}}'. If you can't come up with one, it's okay to use only one of the two words.

Make sure that when your suggestion is put in the blank, it creates a totally different meaning compared to when '{{c1}}', '{{w1}}' or '{{c2}}' is in it. 
Write in lowercase and do not use punctuation. Do not repeat the whole sentence, and only ouput the part that fills the blank.
Sentence: {{b}}
  `,
  fifthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence using both '{{r3}}' and '{{r6}}'. Make sure your suggestion is also similar in its length to '{{c2}}'. If you can't come up with one, it's okay to use only one of the two words.

Make sure that when your suggestion is put in the blank, it creates a totally different meaning compared to when '{{c1}}', '{{w1}}', '{{w2}}, or '{{c2}}' is in it. 
Write in lowercase and do not use punctuation. Do not repeat the whole sentence, and only ouput the part that fills the blank.
Sentence: {{b}}
  `,
  sixthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence using both '{{r4}}' and '{{r5}}'. Make sure your suggestion is also similar in its length to '{{c2}}'. If you can't come up with one, it's okay to use only one of the two words.

Make sure that when your suggestion is put in the blank, it creates a totally different meaning compared to when '{{c1}}', '{{w1}}', '{{w2}}', '{{w3}}'  or '{{c2}}' is in it. 
Write in lowercase and do not use punctuation. Do not repeat the whole sentence, and only ouput the part that fills the blank.
Sentence: {{b}}  `,
  explanationPrompt: `
Do not say in conversational form. Only output the result.
다음 지문의 빈칸에 정답 어구가 들어가야 하는 이유를 한국어로 설명하는 해설을 작성하라. 글의 전반적 내용을 근거로 삼거나, 앞뒤 문맥을 근거로 삼고,
문체는 "~(이)다"체를 사용해야 한다. 
지문: {{p}}
정답: {{c2}}
  `,
trimVerbThatPrompt: `
Do not say in conversational form. Only output the result.
Read the following phrase. If it begins with the combination of 'a verb + that', then output only the remaining phrase following the combination. If it does not begin with that pattern, output the phrase unchanged. 
All output should be in lowercase.
Phrase: {{c1}}
`
};
