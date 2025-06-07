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
    const result = await generateImplicationProblem(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('implication API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate implication question' });
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


async function generateImplicationProblem(passage) {
  const { passage: cleanPassage, asterisked } = extractAsteriskedText(passage);
  
  const i = (await fetchPrompt('consti', { p: cleanPassage })).trim();

    if (i === '0') {
    return {
      problem: '함축 의미가 포함된 어구를 찾을 수 없음',
      answer: null,
      explanation: null
    };
  }

  const bracketedPassage = cleanPassage.replace(i, `<${i}>`);
  const blankedPassage = cleanPassage.replace(i, `<               >`);

  const c = await fetchPrompt('constc', { i, p: bracketedPassage });
  const w = await fetchPrompt('constw', { i, c, p: bracketedPassage });
  const x = await fetchPrompt('constx', { i, c, w, p: bracketedPassage });
  const y = await fetchPrompt('consty', { i, c, w, x, p: bracketedPassage });
  const z = await fetchPrompt('constz', { i, c, w, x, y, p: bracketedPassage });
  
  const numberLabels = ['①', '②', '③', '④', '⑤'];
  const entries = [
    { key: 'c', value: c },
    { key: 'w', value: w },
    { key: 'x', value: x },
    { key: 'y', value: y },
    { key: 'z', value: z },
  ];

  const sorted = entries
    .slice()
    .sort((a, b) => a.value.length - b.value.length)
    .map((entry, idx) => ({
      ...entry,
      numbered: `${numberLabels[idx]} ${entry.value}`,
      number: numberLabels[idx]
    }));

  const question = `밑줄 친 <${i}>가 다음 글에서 의미하는 바로 가장 적절한 것은?\n${bracketedPassage}\n\n${sorted.map(e => e.numbered).join('')}`;

  const e = await fetchPrompt('conste', { p: question });
  const cEntry = sorted.find(entry => entry.key === 'c');
  const answer = cEntry ? cEntry.number : null;

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
 
  consti: `영어 지문에서 함축의미가 담긴 어구 하나를 가리켜 그것이 의미하는 속뜻을 물어보는 객관식 문제를 만들려고 한다. 지금 현재는 영어 지문만이 준비되어 있는 상태다.
  다음 지문을 보고, 글의 흐름상 중요한 비유, 상징적 함축 의미를 담고 있는 어구가 있는지 살펴본 후에 하나를 골라 지문에 사용된 모습 그대로 출력하라.
  단, 어구를 고를 때는 아래 함축의미의 문맥의존도 표를 참고하여, 문맥의존도가 높은 것에서 선택해야 한다.
  
=========문맥의존도 분류표===========
문맥의존도 5 | 단독 문장으로도 해석 가능하지만, 말하는 의도는 불분명함  | 예시 "walking a fine line" from "She’s walking a fine line."
문맥의존도 6 | 이미지 중심의 표현으로 문맥 없이 해석하면 표면적 의미만 전달됨 | 예시 "The ground shifted beneath his feet." from "The ground shifted beneath his feet."
문맥의존도 7 | 표현 자체는 단순하지만 의미가 문맥에 크게 의존함  | 예시 "a paper house" from "It was a paper house from the start."
문맥의존도 8 | 글의 정서, 배경, 인물의 태도를 모르면 의미가 열려 있음 | 예시 "chose silence as his final argument" from "He chose silence as his final argument."
문맥의존도 9 | 글 전체의 흐름 없이 본뜻을 짐작하기 어려움 | 예시 "it wasn't joy that moved her lips" from "She smiled, but it wasn’t joy that moved her lips."
문맥의존도 10 | 문장 단독으로는 의미나 방향조차 해석 불가 | 예시 "the window remained closed." from "And yet, the window remained closed."
(분류표 안에 언급된 예시는 참조대상일 뿐 예시에서 선택할 경우 시스템이 망가질 수 있으니 주의하라
=====================================


======함축 어구를 찾아야 할 지문======
{{p}}
====================================

다른 설명이나, 표시, 마크, 구두점 등은 모두 금지된다. 네가 선택한 어구만을 출력하라. 
[매우 중요] 비유, 상징적 함축 의미가 없는 어구를 출력할 경우, 시스템이 망가질 수 있다. 따라서, 그럴 경우 시스템이 멈출 수 있도록 숫자 0을 출력하라.
  
  `,

  constc: `영어 지문에서 함축의미가 담긴 어구 하나를 가리켜 그것이 의미하는 속뜻을 물어보는 객관식 문제를 만들려고 한다. 지금 현재는 영어 지문과 함축의미가 담긴 어구를 준비해 놓은 상태다.
아래 준비된 지문과, 그 지문에 등장하는 함축의미포함어구를 검토한 후에, 함축의미포함어구의 속뜻을 문맥을 통해 구체적으로 파악하여 함축의미포함어구와 동일한 어법적 형태로 작성, 출력하라.

======지문=======
괄호 친 {{i}}가 다음 글에서 의미하는 바로 가장 적절한 것은?
{{p}}
===함축의미포함어구===
{{i}}

다른 설명은 금지된다. 
마킹이나, 구두점, 표시, 마크는 금지된다.
함축의미포함어구의 속뜻만을 제시된 조건에 맞게 출력하라.

`,

  constw: `영어 지문에서 함축의미가 담긴 어구 하나를 가리켜 그것이 의미하는 속뜻을 물어보는 2지선다의 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 문제와, 정답선택지다. 다음과 같다.

======================
괄호 친 {{i}}가 다음 글에서 의미하는 바로 가장 적절한 것은?
{{p}}

① {{c}}
② 
======================

지금 당장 필요한 것은, 준비된 정답 선택지와 대비될 수 있는 오답 선택지를 만드는 것이다. 
[중요!] 단, 오답 선택지와 정답 선택지는 어구의 품사(Part of speech)만 동일할 뿐 의미가 충분히 달라야 한다. (비슷한 단어를 사용하는 것 절대 금지)
오답 선택지를 만들기 위해 지문에 사용된 다른 어휘를 사용할 수는 있지만, 지문에서 괄호친 어구가 함축하는 의미와는 달라야 한다. (복수정답 방지)
다른 설명 없이, 네가 만든 오답 문장을(번호 제외) 출력하라.
마킹이나 선택지 기호는 입력하지말 것.
`,


  constx: `영어 지문에서 함축의미가 담긴 어구 하나를 가리켜 그것이 의미하는 속뜻을 물어보는 3지선다의 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 문제와, 정답 선택지, 오답 선택지 하나다. 다음과 같다.

======================
괄호 친 {{i}}가 다음 글에서 의미하는 바로 가장 적절한 것은?
{{p}}

① {{c}}
② {{w}}
③ 
======================

지금 당장 필요한 것은, 남은 하나의 오답 선택지를 만드는 것이다. 
[중요!] 단, 선택지들은 서로 어구의 품사(Part of speech)만 동일할 뿐 의미는 충분히 달라야 한다. (비슷한 단어를 사용하는 것 절대 금지)
오답 선택지를 만들기 위해 지문에 사용된 다른 어휘를 사용할 수는 있지만, 지문에서 괄호친 어구가 함축하는 의미와는 달라야 한다. (복수정답 방지)
다른 설명 없이, 네가 만든 오답 문장을(번호 제외) 출력하라.
마킹이나 선택지 기호는 입력하지말 것.
`,

 consty: `영어 지문에서 함축의미가 담긴 어구 하나를 가리켜 그것이 의미하는 속뜻을 물어보는 4지선다의 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 문제와, 정답 선택지, 오답 선택지 둘이다. 다음과 같다.

======================
괄호 친 {{i}}가 다음 글에서 의미하는 바로 가장 적절한 것은?
{{p}}

① {{c}}
② {{w}}
③ {{x}}
④
======================

지금 당장 필요한 것은, 남은 하나의 오답 선택지를 만드는 것이다. 
[중요!] 단, 선택지들은 서로 어구의 품사(Part of speech)만 동일할 뿐 의미는 충분히 달라야 한다. (비슷한 단어를 사용하는 것 절대 금지)
오답 선택지를 만들기 위해 지문에 사용된 다른 어휘를 사용할 수는 있지만, 지문에서 괄호친 어구가 함축하는 의미와는 달라야 한다. (복수정답 방지)
다른 설명 없이, 네가 만든 오답 문장을(번호 제외) 출력하라.
마킹이나 선택지 기호는 입력하지말 것.
`,

  constz: `영어 지문에서 함축의미가 담긴 어구 하나를 가리켜 그것이 의미하는 속뜻을 물어보는 5지선다의 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 문제와, 정답 선택지, 오답 선택지 둘이다. 다음과 같다.

======================
괄호 친 {{i}}가 다음 글에서 의미하는 바로 가장 적절한 것은?
{{p}}

① {{c}}
② {{w}}
③ {{x}}
④ {{y}}
⑤
======================

지금 당장 필요한 것은, 남은 하나의 오답 선택지를 만드는 것이다. 
[중요!] 단, 선택지들은 서로 어구의 품사(Part of speech)만 동일할 뿐 의미는 충분히 달라야 한다. (비슷한 단어를 사용하는 것 절대 금지)
오답 선택지를 만들기 위해 지문에 사용된 다른 어휘를 사용할 수는 있지만, 지문에서 괄호친 어구가 함축하는 의미와는 달라야 한다. (복수정답 방지)
다른 설명 없이, 네가 만든 오답 문장을(번호 제외) 출력하라.
마킹이나 선택지 기호는 입력하지말 것.
`,

  conste: `영어 지문에서 함축의미가 담긴 어구 하나를 가리켜 그것이 의미하는 속뜻을 물어보는 객관식 문제의 해설을 작성해야 한다. 다른 설명은 하지말고 아래 예시의 포맷에 맞추어 주어진 문제를 풀고 그에 대한 해설을 작성해 출력하라.

===포맷===
정답: 번호
(정답의 근거가 될 수 있는 내용)라는 내용의 글이다. 따라서 밑줄 친 부분이 의미하는 바로 가장 적절한 것은 {정답 번호} '{정답 한국어 해석}'이다. [오답해석] {선택지번호 한국어해석 차례대로} 
===예시===
정답: ④
직원의 창의성을 중시하지 않는 기업은 직원의 정신을 블랙박스로 보고, 그 속에서 일어나는 일에 무관심하여 정해진 업무 수행만을 중시하고 탐험되지 않은 영역으로 나아가는 일이 거의 없다 는 내용이다. 따라서 밑줄 친 부분이 의미하는 바로 가장 적절한 것은 ⑤ ‘직원들 정신 내부의 창의적 사고 과정을 충분히 탐구하지 못함’이다. [오답 해석] ① 작업장 안전에 대한 정해진 관행을 부주의하게 간과함 ② 필수 자격을 충족하는 직원을 지속적으로 고용하지 않음 ③ 개방되고 투명한 조직 환경을 억제함 ④ 직원의 창의성을 효과적으로 평가하는 시스템을 제대로 갖추
고 있지 않음=========

===네가 해설을 만들어야할 문제===
{{p}}`
};
