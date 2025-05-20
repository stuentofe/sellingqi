// Vercel 배포용 API Route: 함축의미 파악 
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const { text: passage } = req.body;
  if (!passage || typeof passage !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing passage' });
  }
  try {
    const result = await generateImplicationProblem(passage);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Flow API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// RegExp 특수문자 이스케이프
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

async function generateImplicationProblem(passage) {
  // 1단계: 함축 의미가 담긴 어구(c1) 추출
  const c1 = await fetchInlinePrompt('findImpliedPhrase', { passage });

  // 2단계: 어구를 <>로 감싼다
  const escaped = escapeRegExp(c1);
  const underlinedPassage = passage.replace(new RegExp(escaped), `<${c1}>`);

  // 3단계: 함축 의미 해석 답변 생성
  const impliedMeaning = await fetchInlinePrompt('impliedMeaning', { underlinedPassage });

  // 4단계: <...>로 감싸진 문장만 추출하여 blankedSentence 생성
  const sentenceContainingC1 = underlinedPassage
    .split(/(?<=[.!?])\s+/)
    .find(sentence => sentence.includes(`<${c1}>`)) || '';

  const blankedSentence = sentenceContainingC1.replace(`<${c1}>`, `< >`);

  // 5단계: 문법적 치환 가능 여부 검증 및 수정
  const validatedC2Response = await fetchInlinePrompt('validateC2Fit', {
    impliedMeaning,
    blankedSentence
  });

  const c2 = validatedC2Response.toLowerCase() === 'yes' ? impliedMeaning : validatedC2Response;

  // 6단계: 오답 생성용 어휘 추출 (길이 4자 이상 단어 중 가장 긴 상위 8개)
  const uniqueWords = [...new Set(passage.toLowerCase().match(/\b[a-zA-Z]{4,}\b/g))];
  const longestWords = uniqueWords.sort((a, b) => b.length - a.length).slice(0, 8);
  const [r1, r2, r3, r4, r5, r6, r7, r8] = longestWords;

  // 7단계: 오답 생성
  const w1 = await fetchInlinePrompt('w1Prompt', { r1, r8, c2, blankedSentence });
  const w2 = await fetchInlinePrompt('w2Prompt', { r2, r7, c2, w1, blankedSentence });
  const w3 = await fetchInlinePrompt('w3Prompt', { r3, r6, c2, w1, w2, blankedSentence });
  const w4 = await fetchInlinePrompt('w4Prompt', { r4, r5, c2, w1, w2, w3, blankedSentence });

  // 8단계: 문제 구성
  const options = [c2, w1, w2, w3, w4].sort(() => Math.random() - 0.5);
  const numberSymbols = ['①', '②', '③', '④', '⑤'];
  const numberedOptions = options.map((word, i) => `${numberSymbols[i]} ${word}`).join('\n');

  const answerIndex = options.indexOf(c2);
  if (answerIndex < 0) throw new Error('정답을 선택지에서 찾지 못했습니다.');
  const answer = numberSymbols[answerIndex];

  const explanationText = await fetchInlinePrompt('explanationPrompt', { underlinedPassage, c2});
  const explanation = `정답: ${answer}\n${explanationText}`;

  return {
    problem: `다음 빈칸에 들어갈 말로 가장 적절한 것은?\n\n${underlinedPassage}\n\n${numberedOptions}`,
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
  findImpliedPhrase: `You are part of an English question generation algorithm.
    Never respond in conversational form. Output only the result. 
    Check if the following passage has a phrase (only a noun phrase or a verb phrase consisting of less than 20 words) that is symbolic, figurative in a way that one cannot grasp the implied meaning without the help of the context? 
    If so, output the phrase. If not, say, none. 
    
    Passage: {{passage}}`,

  impliedMeaning: `You are part of an English question generation algorithm.
    Never respond in conversational form. Output only the result. 
    What does the underlined phrase in the following passage figuratively mean? 
    As an answer to the question, provide a grammatically interchangeable expression. 
    Make sure that the parts of speech of the original phrase and your answer are the same.

    Passage: {{underlinedPassage}}`,

  validateC2Fit: `Do not say in conversational form. Only output the result. 
    Is the phrase {{impliedMeaning}} okay to be put in the blank of the sentence grammatically? 
    If so, say yes. 
    If not, provide me with a revised version of {{impliedMeaning}} so that it fits perfectly in the blank. 
    Say no more than that.

    Sentence: {{blankedSentence}}`,

  w1Prompt: `Do not say in conversational form. Only output the result.
    Suggest a phrase that can be put in the blank of the following sentence using both '{{r1}}' and '{{r8}}'. Make sure your suggestion is also similar in its length to '{{c2}}'. If you can't come up with one, it's okay to use only one of the two words.

    Make sure that when your suggestion is put in the blank, it creates a totally different meaning compared to when '{{c2}}' is in it.

    Write in lowercase and do not use punctuation. Do not repeat the whole sentence, and only ouput the part that fills the blank.
    Sentence: {{blankedSentence}}`,

  w2Prompt: `Do not say in conversational form. Only output the result.
    Suggest a phrase that can be put in the blank of the following sentence using both '{{r2}}' and '{{r7}}'. Make sure your suggestion is also similar in its length to '{{c2}}'. If you can't come up with one, it's okay to use only one of the two words.

    Make sure that when your suggestion is put in the blank, it creates a totally different meaning compared to when '{{w1}}' or '{{c2}}' is in it. 
    Write in lowercase and do not use punctuation. Do not repeat the whole sentence, and only ouput the part that fills the blank.
    Sentence: {{blankedSentence}}`,

  w3Prompt: `Do not say in conversational form. Only output the result.
    Suggest a phrase that can be put in the blank of the following sentence using both '{{r3}}' and '{{r6}}'. Make sure your suggestion is also similar in its length to '{{c2}}'. If you can't come up with one, it's okay to use only one of the two words.

    Make sure that when your suggestion is put in the blank, it creates a totally different meaning compared to when '{{w1}}', '{{w2}}', or '{{c2}}' is in it. 
    Write in lowercase and do not use punctuation. Do not repeat the whole sentence, and only ouput the part that fills the blank.
    Sentence: {{blankedSentence}}`,

  w4Prompt: `Do not say in conversational form. Only output the result.
    Suggest a phrase that can be put in the blank of the following sentence using both '{{r4}}' and '{{r5}}'. Make sure your suggestion is also similar in its length to '{{c2}}'. If you can't come up with one, it's okay to use only one of the two words.

    Make sure that when your suggestion is put in the blank, it creates a totally different meaning compared to when '{{w1}}', '{{w2}}', '{{w3}}'or '{{c2}}' is in it. 
    Write in lowercase and do not use punctuation. Do not repeat the whole sentence, and only ouput the part that fills the blank.
    Sentence: {{blankedSentence}}`,

  explanationPrompt: `Do not say in conversational form. Only output the result.
    다음 지문의 <>로 감싼 어구가 의미하는 것이 {{c2}}이유를 설명하는 한국어 해설을 작성하여 한다. 문체는 "~(이)다"체를 사용해야 하고, 지문을 직접 인용해서는 안된다. 100자 이내로 쓰고 반드시 다음 형식을 참고하여 써라: ~라는 내용의 글이다. 따라서, 밑줄 친 문장이 의미하는 바로 가장 적절한 것은 {{c2}} '(c2의 우리말 해석)'이다. 
    지문: {{underlinedPassage}}
    정답: {{c2}}`
};
