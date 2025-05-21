// Vercel 배포용 API Route: 어구 교체형 (빈칸 C 유형)
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

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

function extractAsteriskedText(passage) {
  const match = passage.match(/^(.*?)(\*.+)$/s); // 줄바꿈 포함 전체 매치
  if (match) {
    return {
      passage: match[1].trim(),       // 앞쪽 본문
      asterisked: match[2].trim()     // * 포함 주석
    };
  } else {
    return {
      passage: passage.trim(),        // 주석이 없을 경우 전체 본문 반환
      asterisked: null
    };
  }
}

async function generateBlankcProblem(originalPassage) {
  const { passage, asterisked } = extractAsteriskedText(originalPassage); // ✅ 주석 분리

  const concepts = await fetchInlinePrompt('step2_concepts', { p: passage });
  if (!concepts) throw new Error('요약 개념 추출에 실패했습니다.');

  let c1 = await fetchInlinePrompt('step3_c1_selection', { concepts, p: passage });
  if (!c1 || c1.toLowerCase() === 'none') throw new Error('어구 선택 실패');

  c1 = await fetchInlinePrompt('trimVerbThatPrompt', { c1 }); // ✅ 선행 동사 제거
  const safeC1 = escapeRegExp(c1.toLowerCase());

  const rawSentences = passage.match(/[^.!?]+[.!?]/g)?.map(s => s.trim()) || [];
  const indexedSentences = rawSentences.map((text, id) => ({ id, text }));
  const targetEntries = indexedSentences.filter(({ text }) =>
    text.toLowerCase().match(new RegExp(`\\b${safeC1}\\b`))
  );
  if (targetEntries.length === 0) throw new Error('원문에서 c1 포함 문장을 찾을 수 없습니다.');
  const targetSentence = targetEntries.reduce((a, b) => (a.id > b.id ? a : b)).text;

  const c2 = await fetchInlinePrompt('secondPrompt', { c1, p: passage });
  if (!c2) throw new Error('paraphrase(c2) 생성 실패');

  const blankSentence = targetSentence.replace(new RegExp(`\\b${safeC1}\\b`, 'g'), '[ ]');
  let blankedPassage = passage.replace(new RegExp(`\\b${safeC1}\\b`, 'i'), `${'_'.repeat(20)}`);

  // ✅ 오답 생성을 위한 단어 선정
  const uniqueWords = [...new Set(passage.toLowerCase().match(/\b[a-zA-Z]{4,}\b/g))];
  const longestWords = uniqueWords.sort((a, b) => b.length - a.length).slice(0, 8);
  const [r1, r2, r3, r4, r5, r6, r7, r8] = longestWords;

  const w1 = await fetchInlinePrompt('thirdPrompt', { b: blankSentence, c1, c2, r1, r8 });
  const w2 = await fetchInlinePrompt('fourthPrompt', { b: blankSentence, c1, c2, w1, r2, r7 });
  const w3 = await fetchInlinePrompt('fifthPrompt', { b: blankSentence, c1, c2, w1, w2, r3, r6 });
  const w4 = await fetchInlinePrompt('sixthPrompt', { b: blankSentence, c1, c2, w1, w2, w3, r4, r5 });

  const validatedW1 = await validateWrongWord(w1, blankedPassage);
  const validatedW2 = await validateWrongWord(w2, blankedPassage);
  const validatedW3 = await validateWrongWord(w3, blankedPassage);
  const validatedW4 = await validateWrongWord(w4, blankedPassage);

  const options = [c2, validatedW1, validatedW2, validatedW3, validatedW4]
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);

  // ✅ a(n) 중립화 처리
  const hasArticleBeforeBlank = /\b(a|an)\s+(?=(\[ ?\]|\_+))/i.test(blankedPassage);
  const shouldNeutralizeArticle = (() => {
    const isVowel = w => /^[aeiou]/i.test(w.trim());
    const vowelFlags = options.map(isVowel);
    const allVowel = vowelFlags.every(Boolean);
    const allConsonant = vowelFlags.every(v => !v);
    return !(allVowel || allConsonant);
  })();

  if (hasArticleBeforeBlank && shouldNeutralizeArticle) {
    blankedPassage = blankedPassage.replace(/\b(a|an)\s+(?=(\[ ?\]|\_+))/i, 'a(n) ');
  }

  const numberSymbols = ['①', '②', '③', '④', '⑤'];
  const numberedOptions = options.map((word, i) => `${numberSymbols[i]} ${word}`).join('\n');

  const answerIndex = options.indexOf(c2);
  if (answerIndex < 0) throw new Error('정답을 선택지에서 찾지 못했습니다.');
  const answer = numberSymbols[answerIndex];

  const explanationText = await fetchInlinePrompt('explanationPrompt', { p: blankedPassage, c2 });
  const explanation = `정답: ${answer}\n${explanationText}[지문 변형] 원문 빈칸 표현: ${c1}`;

  return {
    problem: `다음 빈칸에 들어갈 말로 가장 적절한 것은?\n\n${blankedPassage}\n\n${numberedOptions}`,
    answer,
    explanation,
    asterisked // ✅ 주석 따로 보관
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
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
    return data.choices[0].message.content
    .trim()
    .replace(/^"+(.*?)"+$/, '$1');
}

async function validateWrongWord(word, blankedPassage) {
  if (!word) return null;
  const judgment = await fetchInlinePrompt('verifyWrongWord', {
    p: blankedPassage,
    w: word
  });
  return judgment.toLowerCase() === 'no' ? word : judgment;
}

const inlinePrompts = {
  step2_concepts: `
According to Information Processing in a sentence like "The dog is a royal but fierce creature," "The dog" is old information and "its being royal but fierce" is new information. 
Read the following passage, consider its main idea and make a list from the passage of key phrases consisting of more than seven words that can be considered 'new information' in terms of information processing.
But if the corresponding phrase turns out to be placed between parantheses, choose a different one. Make sure you do not add any of 'old information' to the list. Output the items only with no explanation or labeling.
Only separate them with line breaks.

Passage:
{{p}}
`,
  step3_c1_selection: `
The following list of key concepts correspond to some phrases from the following passage. 
You are going to choose one from the list, and find a corresponding phrase from the passage. Skip any phrase that is merely an example. 
Also, skip any phrase that comes after 'and' or 'or', or is followed by 'and' or 'or'. Also skip a phrase placed between parantheses. Choose a different one.
Only output the exact phrase in a verbatim way.

Key Concepts:
{{concepts}}

Passage:
{{p}}
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

Make sure that when your suggestion is put in the blank, it creates a totally different meaning compared to when '{{c1}}', '{{w1}}', '{{w2}}', or '{{c2}}' is in it. 
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
다음 지문의 빈칸에 정답 어구가 들어가야 하는 이유를 한국어로 설명하는 해설을 작성하라. 문체는 "~(이)다"체를 사용해야 한다. 지문을 직접 인용해서는 안된다. 100자 이내로 다음 형식을 참고하여 써라: ~라는 글이다. (필요할 경우 추가 근거) 따라서, 빈칸에 들어갈 말로 가장 적절한 것은 ~이다.
지문: {{p}}
정답: {{c2}}
  `,
trimVerbThatPrompt: `
Do not say in conversational form. Only output the result.
Read the following phrase. If it begins with the combination of 'a verb + that', then output only the remaining phrase following the combination. If it does not begin with that pattern, output the phrase unchanged. 
All output should be in lowercase.
Phrase: {{c1}}
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
