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
    const result = await generateBlankbProblem(passage);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Blankb API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function excludePhrasesWithDisallowedPunctuation(phrases) {
  return phrases.filter(phrase => {
    const hasParen = phrase.includes('(') || phrase.includes(')');
    const hasEmDash = phrase.includes('—');
    const commaIndex = phrase.indexOf(',');
    const hasMidComma = commaIndex !== -1 && commaIndex !== phrase.length - 1;
    return !hasParen && !hasEmDash && !hasMidComma;
  });
}

function excludePhrasesWithAdjacentAndOr(passage, phrases) {
  const normalizedPassage = passage.replace(/\s+/g, ' ');
  const lowerPassage = normalizedPassage.toLowerCase();

  return phrases.filter(phrase => {
    const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const phraseRegex = new RegExp(`\\b${escapedPhrase}\\b`, 'i');
    const match = lowerPassage.match(phraseRegex);
    if (!match) return false;

    const index = match.index;
    const before = lowerPassage.slice(Math.max(0, index - 5), index).trimEnd();
    const after = lowerPassage.slice(index + phrase.length, index + phrase.length + 5).trimStart();

    const hasAndOrBefore = /\b(and|or)$/.test(before);
    const hasAndOrAfter = /^(and|or)\b/.test(after);

    return !(hasAndOrBefore || hasAndOrAfter);
  });
}

function normalizePhrases(phrases) {
  const modalVerbs = [
    'can', 'will', 'may', 'should', 'must',
    "can't", "cannot", "won't", "mayn't", "mustn't",
    'can not', 'will not', 'may not', 'should not', 'must not'
  ];

  function removeLeading(word, phrase) {
    const pattern = new RegExp(`^${word}\\s+`, 'i');
    return phrase.replace(pattern, '').trim();
  }

  return phrases.map(phrase => {
    let result = phrase.trim();

    if (/^not\\s+/i.test(result)) {
      result = removeLeading('not', result);
    }
    if (/^to\\s+/i.test(result)) {
      result = removeLeading('to', result);
    }
    for (const modal of modalVerbs) {
      const pattern = new RegExp(`^${modal}\\s+`, 'i');
      if (pattern.test(result)) {
        result = result.replace(pattern, '').trim();
        break;
      }
    }
    return result;
  });
}

async function generateBlankbProblem(passage) {
  const chunkListRaw = await fetchInlinePrompt('extractChunk', { p: passage });
  const chunkList = chunkListRaw.split('\n').map(s => s.trim()).filter(Boolean);
  const cleanChunkList = excludePhrasesWithDisallowedPunctuation(chunkList);
  const refinedChunkList = excludePhrasesWithAdjacentAndOr(passage, cleanChunkList);

  const danglingPhrasesRaw = await fetchInlinePrompt('detectDanglingEndings', { list: refinedChunkList.join('\n') });
  const danglingPhrases = danglingPhrasesRaw.split('\n').map(s => s.trim()).filter(Boolean);
  const noDanglingPhrases = refinedChunkList.filter(p => !danglingPhrases.includes(p));

  const relativePhrasesRaw = await fetchInlinePrompt('detectRelativePronounEndings', { list: noDanglingPhrases.join('\n') });
  const relativePhrases = relativePhrasesRaw.split('\n').map(s => s.trim()).filter(Boolean);
  const finalChunkList = noDanglingPhrases.filter(p => !relativePhrases.includes(p));

  const normalizedChunkList = normalizePhrases(finalChunkList);

  const c1 = await fetchInlinePrompt('chooseC1FromCleanList', {
    p: passage,
    list: normalizedChunkList.join('\n')
  });

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

  const w1 = await fetchInlinePrompt('thirdPrompt', { b: blankSentence, c1, c2 });
  const w2 = await fetchInlinePrompt('fourthPrompt', { b: blankSentence, c1, c2, w1 });
  const w3 = await fetchInlinePrompt('fifthPrompt', { b: blankSentence, c1, c2, w1, w2 });
  const w4 = await fetchInlinePrompt('sixthPrompt', { b: blankSentence, c1, c2, w1, w2, w3 });

  const options = [c2, w1, w2, w3, w4].filter(Boolean).sort((a, b) => a.length - b.length);

  const blankedPassage = passage.replace(c1, `<${' '.repeat(10)}>`);

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
  extractChunk: `
Do not respond in conversational form. Only output the result.

You are given a passage. Segment the passage into meaningful grammatical phrases consisting of a consecutive string of three to five words that represent constituent meaning units. Each phrase must be either a complete noun phrase or a complete verb phrase.

Write the phrases in a verbatim way including punctuation marks.

Write each phrase on a new line.
Passage: {{p}}
  `,
  detectDanglingEndings: `
Do not respond in conversational form. Only output the result. 

You are given a list of phrases from a passage. (They are all unrelated individual phrases!) 
Identify all phrases that have a dangling element at the end that requires something to be followed after it.

Only include in your output the phrases that meet this condition.
Write each phrase on a new line.
Do not use any additional punctuation.
Do not insert any blank lines.
Do not include any explanation or commentary.

Phrase list: {{list}}
  `,
  detectRelativePronounEndings: `
Do not respond in conversational form. Only output the result.

You are given a list of phrases from a passage. (They are all unrelated individual phrases!) 
Identify all phrases that end with a relative pronoun.

Only include in your output the phrases that meet this condition.
Write each phrase on a new line.
Do not use any additional punctuation.
Do not insert any blank lines.
Do not include any explanation or commentary.

Phrase list: {{list}}
  `,
  chooseC1FromCleanList: `
Do not respond in conversational form. Only output the result.

You are given a passage and a list of refined, grammatically clean phrases extracted from that passage.
From this list, choose one phrase that best captures the central meaning or focus of the passage. 
Base your decision only on the context and content of the passage.

Only return the exact phrase. Do not modify it.
Do not explain your reasoning.
Do not include any other commentary.

Passage: {{p}}

Phrase list:
{{list}}
  `,
  secondPrompt: `
Do not say in conversational form. Only output the result.
I’d like to paraphrase ‘{{c1}}’ in the following passage with a new phrase of similar length. Recommend one.
Do not use punctuation.
Passage: {{p}}
  `,
  thirdPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a totally different meaning compared to when '{{c1}}' or '{{c2}}' is in it. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Do not use punctuation.
Sentence: {{b}}
  `,
  fourthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a totally different meaning compared to when '{{c1}}', '{{c2}}' or '{{w1}}' is in it. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Do not use punctuation.
Sentence: {{b}}
  `,
  fifthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a totally different meaning compared to when '{{c1}}, '{{c2}}', '{{w2}}, or '{{w1}}' is in it. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Do not use punctuation.
Sentence: {{b}}
  `,
  sixthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a totally different meaning compared to when '{{c1}}, '{{c2}}', '{{w2}}, '{{w3}}', or '{{w1}}' is in it. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Do not use punctuation.
Sentence: {{b}}
  `,
  explanationPrompt: `
Do not say in conversational form. Only output the result.
다음 지문의 빈칸에 정답 어구가 들어가야 하는 이유를 한국어로 설명하는 해설을 작성하라. 문체는 "~(이)다"체를 사용해야 한다. 지문을 직접 인용해서는 안된다. 100자 이내로 다음 형식을 참고하여 써라: ~라는 글이다. (필요할 경우 추가 근거) 따라서, 빈칸에 들어갈 말로 가장 적절한 것은 ~이다.

지문: {{p}}
정답: {{c2}}
  `
};
