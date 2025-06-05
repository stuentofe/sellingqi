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
    const result = await generateTopicProblem(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('topic API error:', error);
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


async function generateTopicProblem(passage) {
  const { passage: cleanPassage, asterisked } = extractAsteriskedText(passage);
  const fullPassage = asterisked ? `${cleanPassage}\n${asterisked}` : cleanPassage;

  const c = await fetchPrompt('constc', { p: fullPassage });
  const w = await fetchPrompt('constw', { c, p: fullPassage });
  const x = await fetchPrompt('constx', { c, w, p: fullPassage });
  const y = await fetchPrompt('consty', { c, w, x, p: fullPassage });
  const z = await fetchPrompt('constz', { c, w, x, y, p: fullPassage });

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

  const question = `다음 글의 주제로 가장 적절한 것은?\n${fullPassage}\n\n${sorted.map(e => e.numbered).join('')}`;

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
 
  // --- TOPIC 유형 ---

  constc: `영어 지문을 읽고 글의 주제를 파악해서 고르는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 주제로 가장 적절한 것은?
{{p}}

①
②
③
④
⑤
======================

지금 당장 필요한 것은, 정답 선택지를 만드는 것이다. 정답 선택지는 지문의 요지를 담아내는 영어 명사구여야 한다. 다른 설명 없이, 네가 만든 정답 선택지 하나의 영어 명사구만을(번호 제외) 출력하라. 
문장이 아니므로 첫단어도 소문자로 써라.
마킹이나 숫자는 입력하지말 것.

===예시===
shift in the work-time paradigm brought about by industrialization
effects of standardizing production procedures on labor markets
influence of industrialization on the machine-human relationship
efficient ways to increase the value of time in the Industrial Age
problems that excessive work hours have caused for laborers
=========
`,


  constw: `영어 지문을 읽고 글의 주제를 파악해서 고르는 이지선다형 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 주제로 가장 적절한 것은?
{{p}}

① {{c}}
② 
======================

지금 당장 필요한 것은, 오답 선택지를 채우는 것이다. [중요!] 정답 선택지와 길이만 유사할 뿐 충분히 달라야 한다. (똑같은 단어로 시작하는 것은 금지)
오답 선택지를 만들기 위해 영어지문에 사용된 어휘를 사용할 수는 있지만, 영어지문 내용과 부분적으로 일치하는 것이 오답이 되어서는 안된다. (복수정답 방지)
다른 설명 없이, 네가 만든 오답 명사구를(번호 제외) 출력하라.
문장이 아니므로 첫단어도 소문자로 써라.
마킹이나 숫자는 입력하지말 것.
`,


  constx: `영어 지문을 읽고 글의 주제를 파악해서 고르는 삼지선다형 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 주제로 가장 적절한 것은?
{{p}}

① {{c}}
② {{w}}
③
======================

지금 당장 필요한 것은, 딱 하나 남은 오답 선택지를 채우는 것이다. [중요!] 다른 선택지와 충분히 달라야 한다. (똑같은 단어로 시작하는 것은 금지)
오답 선택지를 만들기 위해 영어지문에 사용된 어휘를 사용할 수는 있지만, 영어지문 내용과 부분적으로 일치하는 것이 오답이 되어서는 안된다. (복수정답 방지)
다른 설명 없이, 네가 만든 오답 명사구를(번호 제외)  출력하라.
문장이 아니므로 첫단어도 소문자로 써라.
마킹이나 숫자는 입력하지말 것.
`,

 consty: `영어 지문을 읽고 글의 주제를 파악해서 고르는 사지선다형 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 주제로 가장 적절한 것은?
{{p}}

① {{c}}
② {{w}}
③ {{x}}
④
======================

지금 당장 필요한 것은, 딱 하나 남은 오답 선택지를 채우는 것이다. [중요!] 다른 선택지와 충분히 달라야 한다. (똑같은 단어로 시작하는 것은 금지)
오답 선택지를 만들기 위해 영어지문에 사용된 어휘를 사용할 수는 있지만, 영어지문 내용과 부분적으로 일치하는 것이 오답이 되어서는 안된다. (복수정답 방지)
다른 설명 없이, 네가 만든 오답 명사구를(번호 제외)  출력하라.
문장이 아니므로 첫단어도 소문자로 써라.
마킹이나 숫자는 입력하지말 것.
`,

  constz: `영어 지문을 읽고 글의 주제를 파악해서 고르는 오지선다형 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 주제로 가장 적절한 것은?
{{p}}

① {{c}}
② {{w}}
③ {{x}}
④ {{y}}
⑤
======================

지금 당장 필요한 것은, 딱 하나 남은 오답 선택지를 채우는 것이다. [중요!] 다른 선택지와 충분히 달라야 한다. (똑같은 단어로 시작하는 것은 금지) 
오답 선택지를 만들기 위해 영어지문에 사용된 어휘를 사용할 수는 있지만, 영어지문 내용과 부분적으로 일치하는 것이 오답이 되어서는 안된다. (복수정답 방지)
다른 설명 없이, 네가 만든 오답 명사구를(번호 제외)  출력하라.
문장이 아니므로 첫단어도 소문자로 써라.
마킹이나 숫자는 입력하지말 것.
`,

  conste: `다음 영어지문의 주제를 파악하는 문제의 해설을 작성해야 한다. 다른 설명은 하지말고 아래 예시의 포맷에 맞추어 주어진 문제를 풀고 그에 대한 해설을 작성해 출력하라.

===포맷===
정답: 원숫자
한국어 해설
[정답 해석] 정답 선택지의 한국어 번역
[오답 해석] 오답 번호 오답 선택지의 한국어 번역 (차례대로)
===예시===
정답: ⑤
자신을 과대평가 또는 과소평가하지 말고 객관적으로 평가하라는 내용의 글이다. 따라서, 글의 주제는 ⑤가 가장 적절하다.
[정답 해석] ⑤ 인생에서 자신의 강점과 약점을 정확하게 평가하는 것의 중요성
[오답 해석] ① 디지털 정보 접근성에서 장애인 고려 부족 ② 정보 접근성과 데이터 분석 효율성 ③ 웹 페이지 접근성 및 정보 획득의 중요성 ④ 건축 설계의 핵심 고려 사항
===네가 해설을 만들어야할 문제===
{{p}}`
};
