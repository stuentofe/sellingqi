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
    const result = await generateBlankaProblem(passage);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Blanka API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// RegExp 특수문자 이스케이프
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}


function extractUniqueContentWords(text) {
  const functionWords = new Set([
    'a', 'an', 'the', 'in', 'on', 'at', 'by', 'for', 'from', 'of', 'to', 'with', 'about',
    'is', 'am', 'are', 'was', 'were', 'be', 'being', 'been',
    'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'will', 'would',
    'shall', 'should', 'may', 'might', 'must',
    'and', 'or', 'but', 'if', 'because', 'as', 'while', 'than', 'so', 'though', 'although',
    'that', 'which', 'who', 'whom', 'whose'
  ]);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  return [...new Set(words.filter(word => word && !functionWords.has(word)))];
}


async function generateBlankaProblem(passage) {
  const rawSentences = passage.match(/[^.!?]+[.!?]/g)?.map(s => s.trim()) || [];
  const indexedSentences = rawSentences.map((text, id) => ({ id, text }));

  const contentWordList = extractUniqueContentWords(passage);
const wordListStr = contentWordList.join(', ');

const c1 = await fetchInlinePrompt('firstPrompt', {
  p: passage,
  words: wordListStr
});

  if (!c1 || c1.trim().toLowerCase() === 'none') {
    throw new Error('중요한 단어를 추출하지 못했습니다.');
  }
  const safeC1 = escapeRegExp(c1.toLowerCase());

const targetEntries = indexedSentences.filter(({ text }) =>
  text.toLowerCase().match(new RegExp(`\\b${safeC1}\\b`))
);

if (targetEntries.length === 0) {
  throw new Error('원문에서 c1 포함 문장을 찾을 수 없습니다.');
}

// 가장 나중에 등장한 문장(id가 가장 큰 것)
const targetSentence = targetEntries.reduce((a, b) => (a.id > b.id ? a : b)).text;


  const c2 = await fetchInlinePrompt('secondPrompt', { c1, p: passage });
  if (!c2) {
    throw new Error('유의어를 추출하지 못했습니다.');
  }

  const blankSentence = targetSentence.replace(
    new RegExp(`\\b${safeC1}\\b`, 'g'),
    '[ ]'
  );

  const w1 = await fetchInlinePrompt('thirdPrompt', { b: blankSentence, c1, c2 });
  const w2 = await fetchInlinePrompt('fourthPrompt', { b: blankSentence, c1, c2, w1 });
  const w3 = await fetchInlinePrompt('fifthPrompt', { b: blankSentence, c1, c2, w1, w2 });
  const w4 = await fetchInlinePrompt('sixthPrompt', { b: blankSentence, c1, c2, w1, w2, w3 });

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
Do not respond in conversational form. Only output the result.
You are given a passage and a list of words that were extracted from the passage.

From the list, select the single word that plays the most important semantic or contextual role in understanding the passage.

Only select one word from the list. If no word from the list is considered important, output "none".
Do not include punctuation. Write in lowercase.

Passage: {{p}}
Word list: {{words}}
`
,
  secondPrompt: `
Do not say in conversational form. Only output the result.
I’d like to replace ‘{{c1}}’ in the following passage with a word which was not used in the passage at all, but which completes the sentence both grammatically and semantically. Recommend one.
Write in lowercase and do not use punctuation.
Passage: {{p}}
  `,
  thirdPrompt: `
Do not say in conversational form. Only output the result.
Name a single word that can be put in the blank of the following sentence, but that when put in it creates a totally different meaning compared to when '{{c1}}' or '{{c2}}' is in it.
Write in lowercase and do not use punctuation.
Sentence: {{b}}
  `,
  fourthPrompt: `
Do not say in conversational form. Only output the result.
Name a single word that can be put in the blank of the following sentence, but that when put in it creates a different meaning compared to when '{{c1}}', '{{c2}}' or '{{w1}}' is in it.
Write in lowercase and do not use punctuation.
Sentence: {{b}}
  `,
  fifthPrompt: `
Do not say in conversational form. Only output the result.
Name a single word that can be put in the blank of the following sentence, but that when put in it creates a different meaning compared to when '{{c1}}', '{{c2}}', '{{w1}}', or '{{w2}}' is in it.
Write in lowercase and do not use punctuation.
Sentence: {{b}}
  `,
  sixthPrompt: `
Do not say in conversational form. Only output the result.
Name a single word that can be put in the blank of the following sentence, but that when put in it creates a different meaning compared to when '{{c1}}, '{{c2}}', '{{w1}}', '{{w2}}', or '{{w3}}' is in it.
Write in lowercase and do not use punctuation.
Sentence: {{b}}
  `,
  explanationPrompt: `
Do not say in conversational form. Only output the result.
다음 지문의 빈칸에 정답 어구가 들어가야 하는 이유를 한국어로 설명하는 해설을 작성하라. 문체는 "~(이)다"체를 사용해야 한다. 지문을 직접 인용해서는 안된다. 100자 이내로 다음 형식을 참고하여 써라: ~라는 글이다. (필요할 경우 추가 근거) 따라서, 빈칸에 들어갈 말로 가장 적절한 것은 ~이다.
지문: {{p}}
정답: {{c2}}
  `
};
