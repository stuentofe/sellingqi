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

// 정규표현식 특수문자 이스케이프
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 의미 있는 단어 추출 (불용어 제거)
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

function extractAsteriskedText(passage) {
  const match = passage.match(/^(.*?)(\*.+)$/s); // s 플래그: 줄바꿈 포함
  if (match) {
    return {
      passage: match[1].trim(),       // 본문만
      asterisked: match[2].trim()     // 주석 별도 저장
    };
  } else {
    return {
      passage: passage.trim(),
      asterisked: null
    };
  }
}

function filterBySpecificity(jsonString, threshold = 0.7) {
  try {
    const parsed = JSON.parse(jsonString);
    return Object.entries(parsed)
      .filter(([_, score]) => score < threshold)
      .map(([word]) => word);
  } catch (e) {
    throw new Error('GPT로부터 받은 구체성 점수 응답이 JSON 형식이 아님: ' + jsonString);
  }
}

function extractWordsFromJsonArray(jsonText, max = 10) {
  try {
    const arr = JSON.parse(jsonText);
    return arr
      .map(obj => obj.word?.trim())
      .filter(Boolean)
      .slice(0, max);
  } catch (e) {
    throw new Error('단어 배열 JSON 파싱 실패: ' + jsonText);
  }
}

function extractAndParseJson(rawText) {
  // Remove markdown-style code blocks (```json ... ```)
  const noCodeBlock = rawText.replace(/^```(?:json)?\n([\s\S]*?)\n```$/, '$1').trim();

  // Clean zero-width and smart quote characters
  const cleaned = noCodeBlock
    .replace(/[\u200B-\u200D\uFEFF]/g, '')     // invisible chars
    .replace(/[“”]/g, '"')                     // curly double quotes
    .replace(/[‘’]/g, "'");                    // curly single quotes

  // Extract the first valid-looking JSON object
  const match = cleaned.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('JSON 응답이 없습니다:\n' + rawText);

  return JSON.parse(match[0]);
}


async function generateBlankaProblem(originalPassage) {
  const { passage, asterisked } = extractAsteriskedText(originalPassage);

  // Step 1: New Information 단어 추출
  const rawKeywordsText = await fetchInlinePrompt('step2_keywords', { p: passage });
  if (!rawKeywordsText) throw new Error('요약 키워드 추출에 실패했습니다.');

  // Step 2: 의미론적 일반성 점수 요청
  const specificityScoresJSON = await fetchInlinePrompt('keywordSpecificity', {
    keywords: rawKeywordsText,
    p: passage
  });

  // Step 3: 구체성 점수 기반으로 필터링
  const cleanedKeywords = filterBySpecificity(specificityScoresJSON);
  if (cleanedKeywords.length === 0) throw new Error('구체적인 키워드가 충분하지 않습니다.');

  // Step 4: 지문 내에서 실제 등장하는 핵심 단어 선택
  const c1 = await fetchInlinePrompt('step3_word_selection', {
    keywords: cleanedKeywords.join('\n'),
    p: passage
  });

  if (!c1 || c1.trim().toLowerCase() === 'none') {
    throw new Error('중요 단어(c1)를 선택하지 못했습니다.');
  }

  const safeC1 = escapeRegExp(c1.toLowerCase());

  const rawSentences = passage.match(/[^.!?]+[.!?]/g)?.map(s => s.trim()) || [];
  const indexedSentences = rawSentences.map((text, id) => ({ id, text }));
  const targetEntries = indexedSentences.filter(({ text }) =>
    text.toLowerCase().match(new RegExp(`\\b${safeC1}\\b`))
  );
  if (targetEntries.length === 0) {
    throw new Error('원문에서 c1 포함 문장을 찾을 수 없습니다.');
  }

  const targetSentence = targetEntries.reduce((a, b) => (a.id > b.id ? a : b)).text;

  // Step 5: 정답 대체 단어 생성
  const c2 = await fetchInlinePrompt('secondPrompt', { c1, p: passage });
  if (!c2) throw new Error('유의어(c2) 추출 실패');

  let blankedPassage = passage.replace(
    new RegExp(`\\b${safeC1}\\b`, 'i'),
    `${'_'.repeat(10)}`
  );

// Step 6: w1, w2 후보 생성
const specificRaw = await fetchInlinePrompt('specificWordsPrompt', { c2, p: blankedPassage });
const specificList = extractWordsFromJsonArray(specificRaw, 10);

const wrongWSelectionRaw = await fetchInlinePrompt('chooseWrongFromListPrompt', {
  p: blankedPassage,
  list: specificList.join(', ')
});
const { w1, w2 } = extractAndParseJson(wrongWSelectionRaw);

// Step 7: w3, w4 후보 생성
const contrastRaw = await fetchInlinePrompt('contrastWordsPrompt', { c2, p: blankedPassage });
const contrastList = extractWordsFromJsonArray(contrastRaw, 10);

const contrastWSelectionRaw = await fetchInlinePrompt('chooseWrongFromListPrompt', {
  p: blankedPassage,
  list: contrastList.join(', ')
});
const { w1: w3, w2: w4 } = extractAndParseJson(contrastWSelectionRaw);


  // Step 8: 선택지 구성 및 정답 위치
  const options = [c2, w1, w2, w3, w4]
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);

  const hasArticleBeforeBlank = /\b(a|an)\s+(?=(\[ ?\]|\_+))/i.test(blankedPassage);
  const shouldNeutralizeArticle = (() => {
    const isVowel = w => /^[aeiou]/i.test(w.trim());
    const vowelFlags = options.map(isVowel);
    return !(vowelFlags.every(Boolean) || vowelFlags.every(v => !v));
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
    asterisked
  };
}


// 프롬프트 기반 요청 함수
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
  if (!data.choices || !data.choices[0]?.message?.content) {
    throw new Error('OpenAI 응답이 비정상적입니다.');
  }

  return data.choices[0].message.content
    .trim()
    .replace(/^"+(.*?)"+$/, '$1'); // ✅ 앞뒤 큰따옴표 제거
}

// (inlinePrompts 그대로 유지, 길어서 생략 가능)


const inlinePrompts = {

  keywordSpecificity: `
다음 지문을 기반으로, 제시된 단어들이 문맥 속에서 얼마나 일반적인 의미로 사용되었는지를 0~1 사이의 점수로 평가해 주세요. 

- 점수 1.0은 매우 일반적이고 추상적인 개념입니다. (예: 존재, 활동, 개체)
- 점수 0.0은 매우 구체적이고 특수한 개념입니다. (예: 특정 사물, 사건, 종족)
- 각 단어는 지문에서 사용된 의미에 따라 판단해주세요.
- 고유명사는 일반성 검사를 생략하고 1.0으로 답변하세요.
- 응답은 JSON 형식으로 출력해주세요. 앞뒤에 json이라는 표시도 금지되며, 다른 설명은 일체 금지됩니다.

단어 목록:
{{keywords}}

지문:
{{p}}
`,

  step2_keywords: `
According to Information Processing in a sentence like "The dog is a royal but fierce creatrue," "The dog" is old information and "its being royal but fierce" is new information. 
Read the following passage, consider its main idea and make a list from the passage of 1-word items that can be considered 'new information' in terms of information processing.
Make sure you do not add any of 'old information' to the list. Output the items.
Separate them with line breaks.

Passage:
{{p}}
`,
  step3_word_selection: `
You are given a list of 1-word items and a passage.

Choose one word item from the list that you think has significance in the passage.
Only output the word verbatim as it appears in the passage. No explanation required.

Keywords:
{{keywords}}

Passage:
{{p}}
`,
  secondPrompt: `
Do not say in conversational form. Only output the result.
I’d like to replace ‘{{c1}}’ in the following passage with a word which was not used in the passage at all, but which completes the sentence both grammatically and semantically. Recommend one.
Write in lowercase and do not use punctuation.
Passage: {{p}}
  `,
explanationPrompt: `
Do not say in conversational form. Only output the result.
다음 지문의 빈칸에 정답 어구가 들어가야 하는 이유를 한국어로 설명하는 해설을 작성하라. 문체는 "~(이)다"체를 사용해야 한다. 지문을 직접 인용해서는 안된다. 100자 이내로 다음 형식을 참고하여 써라: ~라는 글이다. (필요할 경우 추가 근거) 따라서, 빈칸에 들어갈 말로 가장 적절한 것은 ~이다.
지문: {{p}}
정답: {{c2}}
  `,
  specificWordsPrompt: `
다음 문장을 읽고, 주어진 단어가 문맥 속에서 어떤 의미로 사용되었는지를 이해한 뒤,  
그 단어보다 더 구체적인 의미를 가진 단어 10개를 한 단어씩 제시하세요.

조건:
- 각 단어는 실제 사용되는 영어 단어여야 하며, 한 단어로만 구성되어야 합니다.
- 각 단어에 대해 해당 단어의 구체성 점수(specificity score)를 0.0에서 1.0 사이로 부여하세요.
  - 점수 0.0 = 매우 구체적인 개념 (예: bulldog)
  - 점수 1.0 = 매우 일반적인 개념 (예: entity)
  - 각 단어는 기준 단어보다 너무 어려운 단어여서는 안됩니다.
  - 기준 단어의 일반성 점수는 0.5로 가정합니다.
- 결과는 JSON 배열로 출력하세요. 앞뒤에 json이라는 표시도 금지되며, 다른 설명은 일체 금지됩니다.

문장:
{{p}}

기준 단어:
{{c2}}
  `,

  contrastWordsPrompt: `
다음 문장에서 제시된 기준 단어의 문맥 속 의미를 고려하여, 그와 의미상 반대되거나 대조적인 단어들을 한 단어씩 5~10개 추출하세요.

조건:
- 가능한 한 기준 단어와 같은 품사여야 합니다.
- 형태(접미사)가 유사하면 더 좋습니다.
- 각 단어에 대해 의미상 반대 정도를 0.0 ~ 1.0 점수로 나타내주세요.
  - 1.0 = 의미가 완전히 반대
  - 0.0 = 유사하거나 동일한 의미
- 결과는 JSON 배열로 출력해주세요. 앞뒤에 json이라는 표시도 금지되며, 다른 설명은 일체 금지됩니다.

문장:
{{p}}

기준 단어:
{{c2}}
  `,

  chooseWrongFromListPrompt: `
다음 문장은 중요한 단어가 빈칸으로 처리되어 있습니다. 주어진 단어 목록을 보고, 그 중에서 문맥상 들어가면 안 되는 단어 중에서 무작위로 2개를 선택하세요.

조건:
- 단어는 의미상 빈칸에 맞지 않아야 합니다.
- 빈칸에 들어가기에 적절한 단어는 후보에서 제외하세요.
- 반드시 2개의 단어를 선택해야 하며, 선택한 순서는 자유입니다.

결과는 다음 JSON 형식으로 출력하세요. 앞뒤에 json이라는 표시도 금지되며, 다른 설명은 일체 금지됩니다.

{
  "w1": "선택된 첫 번째 단어",
  "w2": "선택된 두 번째 단어"
}

문장:
{{p}}

단어 목록:
{{list}}
  `
};
