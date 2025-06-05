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
    const result = await generateMniQuestion(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('mni API error:', error);
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


async function generateGistProblem(passage) {
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

  const question = `다음 글의 요지로 가장 적절한 것은?\n${fullPassage}\n\n${sorted.map(e => e.numbered).join('\n')}`;

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
 
  // --- GIST 유형 ---

  constc: `영어 지문을 읽고 글의 요지를 파악해서 고르는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 요지로 가장 적절한 것은?
{{p}}

①
②
③
④
⑤
======================

지금 당장 필요한 것은, 정답 선택지를 만드는 것이다. 정답 선택지는 지문의 요지를 담아내는 '~다' 체의 25자 이내의 한국어 문장이어야 한다. 설명 없이, 네가 만든 정답 선택지를 출력하라.
마킹이나 숫자는 입력하지말 것.

`,

  constw: `영어 지문을 읽고 글의 요지를 파악해서 고르는 이지선다형 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 요지로 가장 적절한 것은?
{{p}}

① {{c}}
② 
======================

지금 당장 필요한 것은, 오답 선택지를 한국어 문장으로 채우는 것이다. [중요!] 정답 선택지와 길이만 유사할 뿐 충분히 달라야 한다. (문장 구조나 단어를 흉내내는 것 절대 금지)
오답 선택지를 만들기 위해 영어지문에 사용된 어휘를 한국어 단어로 바꿔 사용할 수는 있지만, 영어지문 내용과 부분적으로 일치하는 것이 오답이 되어서는 안된다. (복수정답 방지)
다른 설명 없이, 네가 만든 오답 문장을(번호 제외) 출력하라.
마킹이나 숫자는 입력하지말 것.
`,


  constx: `영어 지문을 읽고 글의 요지를 파악해서 고르는 삼지선다형 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 요지로 가장 적절한 것은?
{{p}}

① {{c}}
② {{w}}
③
======================

지금 당장 필요한 것은, 딱 하나 남은 오답 선택지를 한국어 문장으로 채우는 것이다. [중요!] 다른 선택지와 충분히 달라야 한다. (문장 구조나 단어를 흉내내는 것 절대 금지) 
오답 선택지를 만들기 위해 영어지문에 사용된 어휘를 한국어 단어로 번역해 사용할 수는 있지만, 영어지문 내용과 부분적으로 일치하는 것이 오답이 되어서는 안된다. (복수정답 방지)
다른 설명 없이, 네가 만든 오답 문장을(번호 제외) 출력하라.
마킹이나 숫자는 입력하지말 것.
`,

 consty: `영어 지문을 읽고 글의 요지를 파악해서 고르는 사지선다형 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 요지로 가장 적절한 것은?
{{p}}

① {{c}}
② {{w}}
③ {{x}}
④
======================

지금 당장 필요한 것은, 딱 하나 남은 오답 선택지를 한국어 문장으로 채우는 것이다. [중요!] 다른 선택지와 충분히 달라야 한다. (문장 구조나 단어를 흉내내는 것 절대 금지) 
오답 선택지를 만들기 위해 영어지문에 사용된 어휘를 한국어로 번역해 사용할 수는 있지만, 영어지문 내용과 부분적으로 일치하는 것이 오답이 되어서는 안된다. (복수정답 방지)
다른 설명 없이, 네가 만든 오답 문장을(번호 제외)  출력하라.
마킹이나 숫자는 입력하지말 것.
`,

  constz: `영어 지문을 읽고 글의 요지를 파악해서 고르는 오지선다형 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 요지로 가장 적절한 것은?
{{p}}

① {{c}}
② {{w}}
③ {{x}}
④ {{y}}
⑤
======================

지금 당장 필요한 것은, 딱 하나 남은 오답 선택지를 한국어 문장으로 채우는 것이다. [중요!] 다른 선택지와 충분히 달라야 한다. (문장 구조나 단어를 흉내내는 것 절대 금지) 
오답 선택지를 만들기 위해 영어지문에 사용된 어휘를 사용할 수는 있지만, 영어지문 내용과 부분적으로 일치하는 것이 오답이 되어서는 안된다. (복수정답 방지)
다른 설명 없이, 네가 만든 오답 문장을(번호 제외) 출력하라.
마킹이나 숫자는 입력하지말 것.
`,

  conste: `다음 영어지문의 요지를 파악하는 문제의 해설을 작성해야 한다. 다른 설명은 하지말고 아래 예시의 포맷에 맞추어 주어진 문제를 풀고 그에 대한 해설을 작성해 출력하라.

===포맷===
정답: 번호
(정답의 근거가 될 수 있는 내용)라는 내용의 글이다. 이러한 글의 요지는, 문장 "(지문에 사용된 영어 문장)" (인용 문장에 대한 한국어해석)에서 가장 명시적으로 드러난다. 따라서 글의 요지는 (정답번호)가 가장 적절하다.
===예시===
정답: ④
정체성은 행동의 반영이며, 믿는 정체성에 따라 행동한다는 내용의 글이다. 이러한 글의 요지는, 문장 "Your behaviors are usually a reflection of your identity." (당신의 행동은 대개 당신의 정체성을 반영하는 것이다.)에서 가장 명시적으로 드러난다. 따라서, 글의 요지는 ④가 가장 적절하다.
=========

===네가 해설을 만들어야할 문제===
{{p}}`
};
