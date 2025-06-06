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
    const result = await generateGrammarProblem(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('grammar API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate grammar question' });
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


async function generateGrammarProblem(passage) {
  const sentencesRaw = passage
    .split(/[.!?]\s+/)
    .filter(s => s.trim().length > 0);

  if (sentencesRaw.length < 5) {
    return {
      problem: '최소 5문장 이상을 입력하세요. (어법5다선지)',
      answer: null,
      explanation: ''
    };
  }

  // 지문 순서 정보 포함
  const fullSentenceList = sentencesRaw.map((text, index) => ({
    text,
    order: index
  }));

  // 가장 긴 문장 5개 선택
  const sentenceList = [...fullSentenceList]
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 5);

  let revisedPassage = passage;
  const prompts = ['consto1', 'consto2', 'consto2', 'consto2', 'consto2'];
  const words = [];

  for (let i = 0; i < 5; i++) {
    const word = (await fetchPrompt(prompts[i], {
      p: revisedPassage,
      s: sentenceList[i].text
    })).trim();

    words.push(word);
    const modSentence = sentenceList[i].text.replace(
      new RegExp(`\\b${word}\\b`),
      `[선택지후보]<${word}>`
    );
    revisedPassage = revisedPassage.replace(sentenceList[i].text, modSentence);
  }

  const randomIndex = Math.floor(Math.random() * words.length);
  const originalWord = words[randomIndex];

  const modifiedWord = (await fetchPrompt('constc', {
    p: passage,
    s: sentenceList[randomIndex].text,
    word: originalWord
  })).trim();

  const finalPassage = revisedPassage.replace(
    `[선택지후보]<${originalWord}>`,
    `[선택지후보]<${modifiedWord}>`
  );

  const regex = /\[선택지후보\]<([^>]+)>/g;
  let match;
  let numberedPassage = finalPassage;
  const matches = [];

  while ((match = regex.exec(finalPassage)) !== null) {
    matches.push({
      index: match.index,
      length: match[0].length,
      word: match[1],
    });
  }

  const numberMap = [];
  matches.reverse().forEach((m, i) => {
    const symbol = getNumberSymbol(matches.length - i);
    numberedPassage =
      numberedPassage.slice(0, m.index) +
      `${symbol} <${m.word}>` +
      numberedPassage.slice(m.index + m.length);
    numberMap.unshift({ word: m.word });
  });

  // ★ 정답 번호 계산용: 지문 순서 기준 sentenceList 만들기
  const sentenceOrder = [...sentenceList].sort((a, b) => a.order - b.order);
  const correctSentence = sentenceList[randomIndex];
  const correctIndex = sentenceOrder.findIndex(s => s.text === correctSentence.text);
  const answer = getNumberSymbol(correctIndex + 1);

  const question = `다음 글의 밑줄 친 부분 중, 어법상 <틀린> 것은?\n${numberedPassage}`;

  const explanation = await fetchPrompt('conste', {
    p: question,
    answer,
    modifiedWord,
    originalWord
  });

  return {
    problem: question,
    answer,
    explanation
  };
}

function getNumberSymbol(n) {
  const symbols = ['①', '②', '③', '④', '⑤'];
  return symbols[n - 1] || n.toString();
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
 
  // Grammr 유형

  consto1: `영어 지문을 읽고 어법상 틀린 것을 선택하는 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?
{{p}}
======================

지금 당장 필요한 것은, 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 선택지로 만드는 작업이다. 너는 다음 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 출력하면 된다. 
너의 답에 대한 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다. 네가 선택한 단어만을 문장 속에 쓰여져 있는 모습 그대로 출력하라.

======조건======
1. function word 중에서 선택한다. [중요] 단, 단일 전치사는 배제한다.
2. 아래 학교 문법 난이도의 위계를 고려하여, 난이도 3, 4 중에서 선택하는 것이 좋다.
3. 단, 난이도 1은 최우선적으로 배제한다.
4. 오직 다음의 경우에 해당될 때만 붙어 있는 두 단어를 같이 선택할 수 있다. 그 외에는 낱개 단어만을 선택한다: 수동태(be + v-ed), 전치사 관계대명사 구문(전치사 +관계대명사)
===============

======학교 문법 난이도의 위계=======
난이도 1: 시제(현재, 과거, 미래), 관사(a, the), be동사와 일반동사의 구분, 인칭대명사와 동사의 수 일치, 명사와 대명사의 수 일치, 형용사와 부사의 기본 차이, 기초 전치사(in, on, at, by 등), 조동사
난이도 2: 현재진행/과거진행, 비교급과 최상급, to부정사와 동명사의 기본적 구분과 쓰임
난이도 3: 의문사절, 수동태(be + p.p.), 목적어로 사용된 to부정사구/동명사구(enjoy v-ing/want to-v), 관계대명사 what, 명사절 that, 동격 that, 감정형용사 -ing/-ed 구분(interesting/interested)
난이도 4: 긴 주어(10단어 이상) 다음에 오는 3인칭 단수 동사, 분사구문, 전치사 + 관계대명사 구문, It ~ that 강조구문, 접속사와 전치사 구별, 가주어/가목적어 구문(It is important to V, I found it difficult to V 등), 복합관계사, 부정어 도치(Never have I seen such a thing.), 대동사
난이도 5: 혼합 가정법(If I had studied, I would be...), what 강조구문 등
=============================


=====지문에 사용된 문장 중 하나인 다음 문장에서 단어를 선택하라=====
{{s}}
`,

  consto2: `영어 지문을 읽고 어법상 틀린 것을 선택하는 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?
{{p}}
======================

지금 당장 필요한 것은, 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 선택지를 하나 더 만드는 작업이다. 너는 다음 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 출력하면 된다. 
너의 답에 대한 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다. 네가 선택한 단어만을 문장 속에 쓰여져 있는 모습 그대로 출력하라.

======조건======
1. function word 중에서 선택한다. [중요] 단, 단일 전치사는 배제한다.
2. 아래 학교 문법 난이도의 위계를 고려하여, 난이도 3, 4 중에서 선택하는 것이 좋다.
3. 단, 난이도 1은 최우선적으로 배제한다.
4. 오직 다음의 경우에 해당될 때만 붙어 있는 두 단어를 같이 선택할 수 있다. 그 외에는 낱개 단어만을 선택한다: 수동태(be + v-ed), 전치사 관계대명사 구문(전치사 +관계대명사)
5. 똑같은 요소를 여러 선택지에서 반복해서 물어서는 안되므로, [선택지후보]로 마킹된 단어가 묻는 요소와 겹치는 요소를 갖는 단어는 배제한다.
===============

======학교 문법 난이도의 위계=======
난이도 1: 시제(현재, 과거, 미래), 관사(a, the), be동사와 일반동사의 구분, 인칭대명사와 동사의 수 일치, 명사와 대명사의 수 일치, 형용사와 부사의 기본 차이, 기초 전치사(in, on, at, by 등), 조동사
난이도 2: 현재진행/과거진행, 비교급과 최상급, to부정사와 동명사의 기본적 구분과 쓰임
난이도 3: 의문사절, 수동태(be + p.p.), 목적어로 사용된 to부정사구/동명사구(enjoy v-ing/want to-v), 관계대명사 what, 명사절 that, 동격 that, 감정형용사 -ing/-ed 구분(interesting/interested)
난이도 4: 긴 주어(10단어 이상) 다음에 오는 3인칭 단수 동사, 분사구문, 전치사 + 관계대명사 구문, It ~ that 강조구문, 접속사와 전치사 구별, 가주어/가목적어 구문(It is important to V, I found it difficult to V 등), 복합관계사, 부정어 도치(Never have I seen such a thing.), 대동사
난이도 5: 혼합 가정법(If I had studied, I would be...), what 강조구문 등
=============================


=====지문에 사용된 문장 중 하나인 다음 문장에서 단어를 선택하라=====
{{s}}
`,

constc: `영어 지문을 읽고 어법상 틀린 것을 선택하는 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

===참조할 지문===
{{p}}
==============
===참조할 문장===
{{s}}
==============

지금 당장 필요한 것은, 위 지문(참조할 지문)에 사용된 문장(참조할 문장) 속의 선택된 단어 하나(아래 제시되었음)를 어법상 틀린 형태로 바꾸는 작업이다. 
그 작업을 위해서 너는 다음 조건에 맞추어 제시된 단어를 문장에 쓰기에는 어법상 틀린 형태로 바꾸어 출력하면 된다. 
너의 답변에 대한 추가적인 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다.

======조건======
1. 아래 학교 문법 난이도의 위계를 고려하여 선택된 단어이므로, 참조한 어법 요소를 알고 있어야 틀린 어법이라는 것을 찾을 수 있도록 변형한다. 
===============

======학교 문법 난이도의 위계=======
난이도 1: 시제(현재, 과거, 미래), 관사(a, the), be동사와 일반동사의 구분, 인칭대명사와 동사의 수 일치, 명사와 대명사의 수 일치, 형용사와 부사의 기본 차이, 기초 전치사(in, on, at, by 등), 조동사
난이도 2: 현재진행/과거진행, 비교급과 최상급, to부정사와 동명사의 기본적 구분과 쓰임
난이도 3: 의문사절, 수동태(be + p.p.), 목적어로 사용된 to부정사구/동명사구(enjoy v-ing/want to-v), 관계대명사 what, 명사절 that, 동격 that, 감정형용사 -ing/-ed 구분(interesting/interested)
난이도 4: 긴 주어 다음에 오는 3인칭 단수 동사, 분사구문, 전치사 + 관계대명사 구문, It ~ that 강조구문, 접속사와 전치사 구별, 가주어/가목적어 구문(It is important to V, I found it difficult to V 등), 복합관계사, 부정어 도치(Never have I seen such a thing.), 대동사
난이도 5: 혼합 가정법(If I had studied, I would be...), what 강조구문 등
=============================

===다음 단어에 대한 대체어휘를 출력하라=====
{{word}}
`,

    conste: `다음 영어지문의 어법상 틀린 것을 찾는 문제의 해설을 작성해야 한다. 다른 설명은 덧붙이지 말고 아래 예시의 포맷에 맞추어 주어진 문제를 풀고 그에 대한 해설을 작성해 출력하라.

===포맷===
정답: circled number
{정답 단어 위치에 고려하는 어법 요소에 대한 설명}이므로, {정답 번호} {정답 어휘}는 {어법상 옳은 형태}로 고쳐야 한다.
===예시===
정답: ⑤
선행사 'the person'이 사람이므로 ⑤ which는 who로 고쳐야 한다.
==========

===네가 해설을 만들어야할 문제===
{{p}}
===정답(어법상 틀린 것)===
{{answer}} {{modifiedWord}} 
===옳은 표현===
{{originalWord}}`,
  
};
