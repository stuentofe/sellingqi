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
    console.error('Blankb API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function extractAsteriskedText(passage) {
  const match = passage.match(/^(.*?)(\*.+)$/s);
  if (match) {
    return {
      passage: match[1].trim(),
      asterisked: match[2].trim()
    };
  } else {
    return {
      passage: passage.trim(),
      asterisked: null
    };
  }
}

function fixArticleBeforeBlank(passageWithBlank, wordToInsert) {
  return passageWithBlank.replace(/\b(a|an)\s+(_{5,})/gi, (match, article, blank) => {
    const startsWithVowel = /^[aeiou]/i.test(wordToInsert.trim());
    const correctArticle = startsWithVowel ? 'an' : 'a';
    return `${correctArticle} ${blank}`;
  });
}

export async function generateBlankbProblem(originalPassage) {
  const { passage, asterisked } = extractAsteriskedText(originalPassage);
  const c1 = await extractC1(passage);

  const rawSentences = passage.match(/[^.!?]+[.!?]/g)?.map(s => s.trim()) || [];
  const indexedSentences = rawSentences.map((text, id) => ({ id, text }));
  const targetEntries = indexedSentences.filter(({ text }) =>
    text.toLowerCase().includes(c1.toLowerCase())
  );

  if (targetEntries.length === 0) {
    throw new Error('Target sentence not found.');
  }

  const targetSentence = targetEntries.reduce((a, b) => (a.id > b.id ? a : b)).text;
  const c2 = await fetchInlinePrompt('secondPrompt', { c1, p: passage });

  if (!c2) {
    throw new Error('Failed to paraphrase c1.');
  }

  const blankSentence = targetSentence.replaceAll(c1, '[ ]');
  let blankedPassage = passage.replace(c1, `${'_'.repeat(15)}`);
  blankedPassage = fixArticleBeforeBlank(blankedPassage, c1);

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

  // ✅ 대소문자 변환 조건 체크
  const sentenceInitial = /^\[|^"\[/.test(blankSentence.trim());

  const adjustedOptions = options.map(opt => {
    if (!opt) return opt;
    return sentenceInitial
      ? opt.charAt(0).toUpperCase() + opt.slice(1)
      : opt.charAt(0).toLowerCase() + opt.slice(1);
  });

  const numberSymbols = ['①', '②', '③', '④', '⑤'];
  const numberedOptions = adjustedOptions.map((word, i) => `${numberSymbols[i]} ${word}`).join('\n');

  const adjustedAnswer = sentenceInitial
    ? c2.charAt(0).toUpperCase() + c2.slice(1)
    : c2.charAt(0).toLowerCase() + c2.slice(1);

  const answerIndex = adjustedOptions.indexOf(adjustedAnswer);
  if (answerIndex < 0) throw new Error('Correct answer not found in options.');
  const answer = numberSymbols[answerIndex];

  const explanationText = await fetchInlinePrompt('explanationPrompt', { p: blankedPassage, c2 });

  const explanation = `정답: ${answer}\n${explanationText}[지문 변형] 원문 빈칸 표현: ${c1}`;

  return {
    problem: `다음 빈칸에 들어갈 말로 가장 적절한 것은?\n\n${blankedPassage}\n\n${numberedOptions}`,
    answer,
    explanation
  };
}

async function extractC1(passage) {
  const concepts = await fetchInlinePrompt('step2_concepts', { p: passage });
  const c1 = await fetchInlinePrompt('step3_c1_selection', { concepts, p: passage });
  if (!c1) throw new Error('Failed to extract c1.');
  return c1;
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
  return data.choices[0].message.content.trim().replace(/^"(.*)"$/, '$1');
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
Read the following passage, consider its main idea and make a list from the passage of key phrases consisting of two to six words that can be considered 'new information' in terms of information processing.
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

Key concepts:
{{concepts}}

Passage:
{{p}}
  `,
  secondPrompt: `
Do not say in conversational form. Only output the result.
I’d like to paraphrase ‘{{c1}}’ in the following passage with a new phrase of similar length. Recommend one.
Passage: {{p}}
  `,
  thirdPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a different meaning from '{{c1}}' or '{{c2}}'. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Write only the part for the blank.
Sentence: {{b}}
  `,
  fourthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a different meaning from '{{c1}}', '{{c2}}' or '{{w1}}'. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Write only the part for the blank.
Sentence: {{b}}
  `,
  fifthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a different meaning from '{{c1}}, '{{c2}}', '{{w2}}, or '{{w1}}'. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Write only the part for the blank.
Sentence: {{b}}
  `,
  sixthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a different meaning from '{{c1}}, '{{c2}}', '{{w2}}, '{{w3}}', or '{{w1}}'. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Write only the part for the blank.
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
If the phrase does NOT fit naturally, just output no.

Only output the phrase or no.
  `
};
