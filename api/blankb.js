// Vercel 배포용 API Route: 어구 교체형 문제 생성
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text: passage } = req.body;

  if (!passage || typeof passage !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing passage' });
  }

  try {
    const result = await generateBlankbProblem(passage);
    return res.status(200).json(result);
  } catch (error) {
    // 👇 여기서 에러 메시지 본문에 포함해서 프론트에서 바로 볼 수 있도록
    return res.status(500).json({
      error: '문제 생성 실패',
      details: error.message,
      full: error
    });
  }
}

async function generateBlankbProblem(passage) {
  // ✅ 새 방식으로 c1 추출
  const c1 = await extractC1(passage);

  const rawSentences = passage.match(/[^.!?]+[.!?]/g)?.map(s => s.trim()) || [];
  const indexedSentences = rawSentences.map((text, id) => ({ id, text }));
  const targetEntries = indexedSentences.filter(({ text }) =>
    text.toLowerCase().includes(c1.toLowerCase())
  );

  if (targetEntries.length === 0) {
    throw new Error('원문에서 c1 포함 문장을 찾을 수 없습니다.');
  }

  const targetSentence = targetEntries.reduce((a, b) => (a.id > b.id ? a : b)).text;

  const c2 = await fetchInlinePrompt('secondPrompt', { c1, p: passage });
  if (!c2) {
    throw new Error('paraphrase에 실패했습니다.');
  }

  const blankSentence = targetSentence.replaceAll(c1, '[ ]');
  const blankedPassage = passage.replace(c1, `<${' '.repeat(10)}>`);

  const w1Raw = await fetchInlinePrompt('thirdPrompt', { b: blankSentence, c1, c2 });
  const w2Raw = await fetchInlinePrompt('fourthPrompt', { b: blankSentence, c1, c2, w1: w1Raw });
  const w3Raw = await fetchInlinePrompt('fifthPrompt', { b: blankSentence, c1, c2, w1: w1Raw, w2: w2Raw });
  const w4Raw = await fetchInlinePrompt('sixthPrompt', { b: blankSentence, c1, c2, w1: w1Raw, w2: w2Raw, w3: w3Raw });

  const validatedW1 = await validateWrongWord(w1Raw, blankedPassage);
  const validatedW2 = await validateWrongWord(w2Raw, blankedPassage);
  const validatedW3 = await validateWrongWord(w3Raw, blankedPassage);
  const validatedW4 = await validateWrongWord(w4Raw, blankedPassage);

  const options = [c2, validatedW1, validatedW2, validatedW3, validatedW4]
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);

  const numberSymbols = ['①', '②', '③', '④', '⑤'];
  const numberedOptions = options.map((word, i) => `${numberSymbols[i]} ${word}`).join('\n');

  const answerIndex = options.indexOf(c2);
  if (answerIndex < 0) throw new Error('정답을 선택지에서 찾지 못했습니다.');
  const answer = numberSymbols[answerIndex];

  const explanationText = await fetchInlinePrompt('explanationPrompt', { p: blankedPassage, c2 });
  const explanation = `정답: ${answer}\n${explanationText}[지문 변형] 원문 빈칸 표현: ${c1}`;

const problem = `다음 빈칸에 들어갈 말로 가장 적절한 것은?\n\n${blankedPassage}\n\n${numberedOptions}`;

// ✅ 여기에 저장
await saveToDB({
  passage,
  problem,
  answer,
  explanation
});

return {
  problem,
  answer,
  explanation
};
}

async function extractC1(passage) {
  const summary = await fetchInlinePrompt('step1_summary', { p: passage });
  const concepts = await fetchInlinePrompt('step2_concepts', { summary, p: passage });
  const c1 = await fetchInlinePrompt('step3_c1_selection', { concepts, p: passage });

  if (!c1) throw new Error('c1 추출에 실패했습니다.');
  return c1;
}

async function validateWrongWord(word, blankedPassage) {
  if (!word) return null;
  const result = await fetchInlinePrompt('verifyWrongWord', {
    p: blankedPassage,
    w: word
  });
  return result.toLowerCase() === 'no' ? word : result;
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
  // 🆕 STEP 1: 요약
  step1_summary: `
Summarize the following within 30 words limit:
{{p}}
Do not respond in conversational form. Do not include labels, headings, or explanations.
Only output the summary.
  `,

  // 🆕 STEP 2: 요약에서 key concepts 추출
  step2_concepts: `
The following is a summary of a passage. 
Extract key concepts from this summary that help grasp the meaning of the original passage.
Each concept should be a noun phrase or a verb phrase (2–7 words).
Do not add any explanations, labels, or formatting. Write each concept on a new line.

Summary:
{{summary}}

Original passage for reference:
{{p}}
  `,

  // 🆕 STEP 3: 지문에서 key concept에 해당하는 어구 선택 (verbatim)
  step3_c1_selection: `
The following is a list of key concepts extracted from the summary of the passage.

If any of these key concepts (in the form of noun or verb phrases, 2–7 words) appear in the original passage, select one that is most relevant and copy it exactly as it appears in the original passage. If the key concepts correspond to a whole sentence, then only select a part of it, preferrably a noun phrase or a verb phrase in the sentence.

Preserve original casing and punctuation.  
Do not output anything other than the exact phrase.

Key concepts:
{{concepts}}

Passage:
{{p}}
  `,

  // 기존 유지: paraphrase 생성
  secondPrompt: `
Do not say in conversational form. Only output the result.
I’d like to paraphrase ‘{{c1}}’ in the following passage with a new phrase of similar length. Recommend one.
Do not use punctuation.
Passage: {{p}}
  `,

  thirdPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a different meaning from '{{c1}}' or '{{c2}}'. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Do not use punctuation. Write only the part for the blank.
Sentence: {{b}}
  `,

  fourthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a different meaning from '{{c1}}', '{{c2}}' or '{{w1}}'. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Do not use punctuation. Write only the part for the blank.
Sentence: {{b}}
  `,

  fifthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a different meaning from '{{c1}}, '{{c2}}', '{{w2}}, or '{{w1}}'. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Do not use punctuation. Write only the part for the blank.
Sentence: {{b}}
  `,

  sixthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a different meaning from '{{c1}}, '{{c2}}', '{{w2}}, '{{w3}}', or '{{w1}}'. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Do not use punctuation. Write only the part for the blank.
Sentence: {{b}}
  `,

  explanationPrompt: `
Do not say in conversational form. Only output the result.
다음 지문의 빈칸에 정답 어구가 들어가야 하는 이유를 한국어로 설명하는 해설을 작성하라. 문체는 "~(이)다"체를 사용해야 한다. 지문을 직접 인용해서는 안된다. 100자 이내로 다음 형식을 참고하여 써라: ~라는 글이다. (필요할 경우 추가 근거) 따라서, 빈칸에 들어갈 말로 가장 적절한 것은 ~이다.

지문: {{p}}
정답: {{c2}}
  `,

  verifyWrongWord: `
Evaluate whether the following phrase fits naturally in the blank of the given passage.

Passage with blank:
{{p}}

Phrase: {{w}}

If the phrase fits naturally and makes the sentence contextually appropriate, output a different phrase of similar length that sounds inappropriate in this context. 
If the phrase does NOT fit naturally, just output "no".

Only output the phrase or "no" with no punctuation or explanation.
  `
};


import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function saveToDB(data) {
  const { error } = await supabase.from('problems').insert([data]);
  if (error) {
    console.error('❌ Supabase 저장 실패:', error.message);
    throw new Error('Supabase 저장 실패');
  }
}
