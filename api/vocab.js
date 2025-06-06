import fs from 'fs/promises';
import path from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text: passage } = req.body;
  if (!passage || typeof passage !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing passage' });
  }

  try {
    const result = await generateVocabProblem(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('vocab API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate main idea question' });
  }
}

function extractAsteriskedText(passage) {
  const match = passage.match(/^(.*?)(\*.+)$/s); // 줄바꿈 포함
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


async function generateVocabProblem(passage) {
  const sentences = passage.split(/[.!?]\s+/).filter(s => s.trim().length > 0);
  if (sentences.length < 5) {
    return {
      problem: '최소 5문장 이상을 입력하세요.',
      answer: null,
      explanation: ''
    };
  }

  const { passage: cleanPassage, asterisked } = extractAsteriskedText(passage);

const sentenceList = cleanPassage
  .split(/[.!?]\s+/)
  .filter(s => s.trim().length > 0)
  .sort((a, b) => b.length - a.length)
  .slice(0, 5)
  .map((s, i) => ({ id: `s${i + 1}`, text: s }));

console.log('📌 sentenceList (Top 5 longest sentences):');
sentenceList.forEach((s, i) => {
  console.log(`${i + 1}: ${s.text}`);
});

  let revisedPassage = cleanPassage;

  const o1 = await fetchPrompt('consto1', { p: cleanPassage, s: sentenceList[0].text });
  const word1 = o1.trim();
  const s1Mod = sentenceList[0].text.replace(new RegExp(`\\b${word1}\\b`), `[선택지후보]${word1}`);
  revisedPassage = revisedPassage.replace(sentenceList[0].text, s1Mod);

  const o2 = await fetchPrompt('consto2', { p: revisedPassage, s: sentenceList[1].text });
  const word2 = o2.trim();
  const s2Mod = sentenceList[1].text.replace(new RegExp(`\\b${word2}\\b`), `[선택지후보]${word2}`);
  revisedPassage = revisedPassage.replace(sentenceList[1].text, s2Mod);

  const o3 = await fetchPrompt('consto3', { p: revisedPassage, s: sentenceList[2].text });
  const word3 = o3.trim();
  const s3Mod = sentenceList[2].text.replace(new RegExp(`\\b${word3}\\b`), `[선택지후보]${word3}`);
  revisedPassage = revisedPassage.replace(sentenceList[2].text, s3Mod);

  const o4 = await fetchPrompt('consto4', { p: revisedPassage, s: sentenceList[3].text });
  const word4 = o4.trim();
  const s4Mod = sentenceList[3].text.replace(new RegExp(`\\b${word4}\\b`), `[선택지후보]${word4}`);
  revisedPassage = revisedPassage.replace(sentenceList[3].text, s4Mod);

  const o5 = await fetchPrompt('consto5', { p: revisedPassage, s: sentenceList[4].text });
  const word5 = o5.trim();
  const s5Mod = sentenceList[4].text.replace(new RegExp(`\\b${word5}\\b`), `[선택지후보]${word5}`);
  revisedPassage = revisedPassage.replace(sentenceList[4].text, s5Mod);

  const choices = [
    { word: word1, sentence: sentenceList[0].text },
    { word: word2, sentence: sentenceList[1].text },
    { word: word3, sentence: sentenceList[2].text },
    { word: word4, sentence: sentenceList[3].text },
    { word: word5, sentence: sentenceList[4].text }
  ];
  const randomIndex = Math.floor(Math.random() * choices.length);
  const targetChoice = choices[randomIndex];

  const originalWord = [o1, o2, o3, o4, o5][randomIndex].trim();
  const originalSentence = sentenceList[randomIndex].text;

  const c = await fetchPrompt('constc', { p: cleanPassage, s: originalSentence, word: originalWord });

  const finalPassage = revisedPassage.replace(
    `[선택지후보]${originalWord}`,
    `[선택지후보]${c.trim()}`
);


  const optionRegex = /\[선택지후보\](\w+)/g;
  let match;
  let index = 0;
  let numberedPassage = finalPassage;
  const numberMap = [];

  function getNumberSymbol(n) {
    const symbols = ['①', '②', '③', '④', '⑤'];
    return symbols[n - 1] || n.toString();
  }

  while ((match = optionRegex.exec(finalPassage)) !== null) {
    index++;
    const word = match[1];
    const numbered = `${getNumberSymbol(index)} <${word}>`;
    numberedPassage = numberedPassage.replace(`[선택지후보]${word}`, numbered);
    numberMap.push({ word, number: index }); // 정답 계산용
  }

  const question = `다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?\n${numberedPassage}`;
  const answerEntry = numberMap.find(entry => entry.word === c.trim());
 
function getNumberSymbol(n) {
  const symbols = ['①', '②', '③', '④', '⑤'];
  return symbols[n - 1] || n.toString();
}

const answer = answerEntry ? getNumberSymbol(answerEntry.number) : null;

  const e = await fetchPrompt('conste', { p: question });

  return {
    problem: question,
    answer: answer,
    explanation: e
  };
}

async function fetchPrompt(key, replacements = {}, model = 'gemini-2.0-flash') {
  const promptTemplate = inlinePrompts[key];
  if (!promptTemplate) {
    throw new Error(`Unknown prompt key: ${key}`);
  }

  let prompt = promptTemplate;
  for (const k in replacements) {
    prompt = prompt.replace(new RegExp(`{{${k}}}`, 'g'), replacements[k]);
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const res = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.7
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      })
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(`Gemini API error: ${res.status} ${error?.error?.message}`);
    }

    const data = await res.json();
    const fullText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!fullText) {
      throw new Error('Gemini 응답이 비었거나 예상과 다른 형식입니다.');
    }

    return fullText;

  } catch (err) {
    console.error('[Gemini API Error]', err);
    throw err;
  }
}

const inlinePrompts = {
 
  // Vocab 유형

  consto1: `영어 지문을 읽고 글의 문맥상 낱말의 적절한 쓰임을 파악하도록 하는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?
{{p}}
======================

지금 당장 필요한 것은, 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 선택지로 만드는 작업이다. 너는 다음 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 출력하면 된다. 
너의 답에 대한 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다. 네가 선택한 단어만을 문장 속에 쓰여져 있는 모습 그대로 출력하라.

======조건======
1. 지문의 수준에 비해 너무 낮은 단어는 배제한다.
2. 사람이나 지역, 단체의 이름과 같은 고유명사는 배제한다.
3. 낱말의 쓰임이 과연 적절한 것인지를 판단 할 때 문장만 보아도 알 수 있는 것은 배제한다.
4. 문장 뿐만 아니라 이전 문장과 이후 문장 등 지문의 맥락을 고려해야 판단할 수 있는 단어를 우선적으로 고려한다.
===============

=====지문에 사용된 문장 중 하나인 다음 문장에서 단어를 선택하라=====
{{s}}
`,

  consto2: `영어 지문을 읽고 글의 문맥상 낱말의 적절한 쓰임을 파악하도록 하는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?
{{p}}
======================

지금 당장 필요한 것은, 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 또 하나의 선택지로 만드는 작업이다. 
그 작업을 위해서 너는 다음 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 출력하면 된다. 
너의 답변에 대한 추가적인 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다. 네가 선택한 단어만을 문장 속에 쓰여져 있는 모습 그대로 출력하라.

======조건======
1. 지문의 수준에 비해 너무 낮은 단어는 배제한다.
2. 똑같은 선택지가 겹쳐서는 안되므로 이미 지문에 [선택지후보]로 마킹된 단어는 배제한다.
3. 사람이나 지역, 단체의 이름과 같은 고유명사는 배제한다.
4. 낱말의 쓰임이 과연 적절한 것인지를 판단 할 때 문장만 보아도 알 수 있는 것은 배제한다.
5. 문장 뿐만 아니라 이전 문장과 이후 문장 등 지문의 맥락을 고려해야 판단할 수 있는 단어를 우선적으로 고려한다.
===============

=====지문에 사용된 문장 중 하나인 다음 문장에서 단어를 선택하라=====
{{s}}
`,

consto3: `영어 지문을 읽고 글의 문맥상 낱말의 적절한 쓰임을 파악하도록 하는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?
{{p}}
======================

지금 당장 필요한 것은, 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 또 하나의 선택지로 만드는 작업이다. 
그 작업을 위해서 너는 다음 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 출력하면 된다. 
너의 답변에 대한 추가적인 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다. 네가 선택한 단어만을 문장 속에 쓰여져 있는 모습 그대로 출력하라.

======조건======
1. 지문의 수준에 비해 너무 낮은 단어는 배제한다.
2. 똑같은 선택지가 겹쳐서는 안되므로 이미 지문에 [선택지후보]로 마킹된 단어는 배제한다.
3. 사람이나 지역, 단체의 이름과 같은 고유명사는 배제한다.
4. 낱말의 쓰임이 과연 적절한 것인지를 판단 할 때 문장만 보아도 알 수 있는 것은 배제한다.
5. 문장 뿐만 아니라 이전 문장과 이후 문장 등 지문의 맥락을 고려해야 판단할 수 있는 단어를 우선적으로 고려한다.
===============

=====지문에 사용된 문장 중 하나인 다음 문장에서 단어를 선택하라=====
{{s}}
`,

consto4: `영어 지문을 읽고 글의 문맥상 낱말의 적절한 쓰임을 파악하도록 하는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?
{{p}}
======================

지금 당장 필요한 것은, 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 또 하나의 선택지로 만드는 작업이다. 
그 작업을 위해서 너는 다음 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 출력하면 된다. 
너의 답변에 대한 추가적인 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다. 네가 선택한 단어만을 문장 속에 쓰여져 있는 모습 그대로 출력하라.

======조건======
1. 지문의 수준에 비해 너무 낮은 단어는 배제한다.
2. 똑같은 선택지가 겹쳐서는 안되므로 이미 지문에 [선택지후보]로 마킹된 단어는 배제한다.
3. 사람이나 지역, 단체의 이름과 같은 고유명사는 배제한다.
4. 낱말의 쓰임이 과연 적절한 것인지를 판단 할 때 문장만 보아도 알 수 있는 것은 배제한다.
5. 문장 뿐만 아니라 이전 문장과 이후 문장 등 지문의 맥락을 고려해야 판단할 수 있는 단어를 우선적으로 고려한다.
===============

=====지문에 사용된 문장 중 하나인 다음 문장에서 단어를 선택하라=====
{{s}}
`,

consto5: `영어 지문을 읽고 글의 문맥상 낱말의 적절한 쓰임을 파악하도록 하는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?
{{p}}
======================

지금 당장 필요한 것은, 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 또 하나의 선택지로 만드는 작업이다. 
그 작업을 위해서 너는 다음 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 출력하면 된다. 
너의 답변에 대한 추가적인 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다. 네가 선택한 단어만을 문장 속에 쓰여져 있는 모습 그대로 출력하라.

======조건======
1. 지문의 수준에 비해 너무 낮은 단어는 배제한다.
2. 똑같은 선택지가 겹쳐서는 안되므로 이미 지문에 [선택지후보]로 마킹된 단어는 배제한다.
3. 사람이나 지역, 단체의 이름과 같은 고유명사는 배제한다.
4. 낱말의 쓰임이 과연 적절한 것인지를 판단 할 때 문장만 보아도 알 수 있는 것은 배제한다.
5. 문장 뿐만 아니라 이전 문장과 이후 문장 등 지문의 맥락을 고려해야 판단할 수 있는 단어를 우선적으로 고려한다.
===============

=====지문에 사용된 문장 중 하나인 다음 문장에서 단어를 선택하라=====
{{s}}
`,

constc: `영어 지문을 읽고 글의 문맥상 낱말의 적절한 쓰임을 파악하도록 하는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

===참조할 지문===
{{p}}
==============
===참조할 문장===
{{s}}
==============

지금 당장 필요한 것은, 위 지문(참조할 지문)에 사용된 문장(참조할 문장) 속 단어 하나를 문맥상 부적절한 어휘로 바꾸는 작업이다. 
그 작업을 위해서 너는 다음 조건에 맞추어 아래 제시된 어휘의 문맥상 부적절한 대체 어휘를 생각해내 출력하면 된다. 
너의 답변에 대한 추가적인 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다. 네가 생각해낸 대체 단어를 문장에 그대로 대체해도 좋은 형태로 출력하라.

======조건======
1. 지문의 수준에 비해 너무 낮거나 높은 단어는 배제한다.
2. 문맥상 부자연스럽기 때문에 부적절한 어휘로 판단할 수 있어야 한다.
3. '정답없음'으로 오류 문제가 될 수 있으니 유의어는 반드시 배제한다.
===============

===다음 단어에 대한 대체어휘를 출력하라=====
{{word}}
`,

  conste: `다음 영어지문의 문맥상 적절하지 않은 어휘를 찾는 문제의 해설을 작성해야 한다. 다른 설명은 덧붙이지 말고 아래 예시의 포맷에 맞추어 주어진 문제를 풀고 그에 대한 해설을 작성해 출력하라.

===포맷===
정답: circled number
{선택지의 앞 문장이나 뒷 문장을 통한 근거}라고 하였으므로, '{정답이 들어간 어구의 해석}'라는 흐름이 자연스럽다. 따라서, {정답 번호} {정답 어휘}(한국어 해석)을 {적절한 대체어휘}(한국어해석) 등으로 바꿔야 한다. [오답] 오답 어휘와 한국어번역 (순서대로)
===예시===
정답: ⑤
문장 뒤에서, 그 결과 타인들도 당신을 과소평가할 수 있다고 하였으므로 '너 자신을 과소평가해서는 안된다.'라는 흐름이 자연스럽다. 따라서, ⑤ overestimate(과대평가하다)를 underestimate(과소평가하다) 등으로 바꿔야 한다. [오답] ① evaluate(평가하다) ② validate(타당화하다) ③ rationalize(합리화하다) ④ generalize(일반화하다)
===네가 해설을 만들어야할 문제===
{{p}}`

};

