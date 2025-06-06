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
    const result = await generateDetaileProblem(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('detaile API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate detaile question' });
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


async function generateDetaileProblem(passage) {
  const { passage: cleanPassage, asterisked } = extractAsteriskedText(passage);
  const fullPassage = asterisked ? `${cleanPassage}\n${asterisked}` : cleanPassage;


  const o1 = await fetchPrompt('consto1', { p: fullPassage });
  const o2 = await fetchPrompt('consto2', { o1, p: fullPassage });
  const o3 = await fetchPrompt('consto3', { o2, o1, p: fullPassage });
  const o4 = await fetchPrompt('consto4', { o3, o2, o1, p: fullPassage });
  const o5 = await fetchPrompt('consto5', { o4, o3, o2, o1, p: fullPassage });
  
  const options = [o1, o2, o3, o4, o5];
  const wrongIndex = Math.floor(Math.random() * options.length);
  const wrongOriginal = options[wrongIndex];

  const c = await fetchPrompt('constc', { o: wrongOriginal, p: fullPassage });
  options[wrongIndex] = c;

  const choices = options.map((opt, idx) => `\u2460\u2461\u2462\u2463\u2464`[idx] + ' ' + opt);
  const answer = ['①', '②', '③', '④', '⑤'][wrongIndex];

  const question = `다음 글의 내용과 일치하지 않는 것은?\n${fullPassage}\n\n${choices.join('')}`;
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
consto1: `영어 지문을 읽고 글의 세부정보를 파악해서 선택지 중 글의 내용과 일치하지 않는 것을 고르는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 내용과 일치하지 않는 것은?
{{p}}

①
②
③
④
⑤
======================

지금 당장 필요한 것은, 지문을 읽고 선택지 ①에 들어갈 영어 문장을 만드는 것이다. 이것은 지문에서 언급된 정보 중에서 제일 먼저 언급된 사실적 정보를 담도록 한다.
선택지와 지문에 적힌 내용이 동일하지 않도록 의미는 동일하더라도 표현과 문장구조를 고쳐 써야 한다. 20단어 이내로 써라.
네가 만든 문장을 출력할 때에는 번호를 붙이거나 다른 마킹하는 것은 금지된다. 오직 생성한 문장만을 출력하라.`,
  
consto2: `영어 지문을 읽고 글의 세부정보를 파악해서 선택지 중 글의 내용과 일치하지 않는 것을 고르는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 내용과 일치하지 않는 것은?
{{p}}

① {{o1}}
②
③
④
⑤
======================

지금 당장 필요한 것은, 지문을 읽고 선택지 ②에 들어갈 영어 문장을 만드는 것이다. 이것은 지문에서 언급된 정보 중에서 ①번에 담긴 정보 이후에 가장 먼저 언급된 사실적 정보를 담도록 한다. 
선택지와 지문에 적힌 내용이 동일하지 않도록 의미는 동일하더라도 표현과 문장구조를 고쳐 써야 한다. 20단어 이내로 써라.
다른 설명을 추가하는 것은 금지된다. 번호나 다른 마킹도 금지된다. 오직 네가 만든 문장만을 출력하라.`,
consto3: `영어 지문을 읽고 글의 세부정보를 파악해서 선택지 중 글의 내용과 일치하지 않는 것을 고르는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 내용과 일치하지 않는 것은?
{{p}}

① {{o1}}
② {{o2}}
③
④
⑤
======================

지금 당장 필요한 것은, 지문을 읽고 선택지 ③에 들어갈 문장을 만드는 것이다. 이것은 지문에서 언급된 정보 중에서 ①번, ②번에 담긴 정보 이후에 가장 먼저 언급된 사실적 정보를 담도록 한다. 
선택지와 지문에 적힌 내용이 동일하지 않도록 의미는 동일하더라도 표현과 문장구조를 고쳐 써야 한다. 20단어 이내의 영어 문장 하나로 써라.
다른 설명을 추가하는 것은 금지된다. 번호나 다른 마킹도 금지된다. 오직 네가 만든 문장만을 출력하라.`,
consto4: `영어 지문을 읽고 글의 세부정보를 파악해서 선택지 중 글의 내용과 일치하지 않는 것을 고르는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 내용과 일치하지 않는 것은?
{{p}}

① {{o1}}
② {{o2}}
③ {{o3}}
④
⑤
======================

지금 당장 필요한 것은, 지문을 읽고 선택지 ④에 들어갈 문장을 만드는 것이다. 이것은 지문에서 언급된 정보 중에서 ①번, ②번, ③번에 담긴 정보 이후에 가장 먼저 언급된 사실적 정보를 담도록 한다. 
선택지와 지문에 적힌 내용이 동일하지 않도록 의미는 동일하더라도 표현과 문장구조를 고쳐 써야 한다. 20단어 이내의 영어 문장 하나로 써라.
다른 설명을 추가하는 것은 금지된다. 번호나 다른 마킹도 금지된다. 오직 네가 만든 문장만을 출력하라.`,
consto5: `영어 지문을 읽고 글의 세부정보를 파악해서 선택지 중 글의 내용과 일치하지 않는 것을 고르는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 내용과 일치하지 않는 것은?
{{p}}

① {{o1}}
② {{o2}}
③ {{o3}}
④ {{o4}}
⑤
======================

지금 당장 필요한 것은, 지문을 읽고 선택지 ⑤에 들어갈 문장을 만드는 것이다. 이것은 지문에서 언급된 정보 중에서 ①번, ②번, ③번, ④번에 담긴 정보 이후에 가장 먼저 언급된 사실적 정보를 담도록 한다.
선택지와 지문에 적힌 내용이 동일하지 않도록 의미는 동일하더라도 표현과 문장구조를 고쳐 써야 한다. 20단어 이내의 영어 문장 하나로 써라.
다른 설명을 추가하는 것은 금지된다. 번호나 다른 마킹도 금지된다. 오직 네가 만든 문장만을 출력하라.`,
constc: `영어 지문을 읽고 글의 세부정보를 파악해서 선택지 중 글의 내용과 일치하지 않는 것을 고르는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
다음 글의 내용과 일치하지 않는 것은?
{{p}}

① {{o1}}
② {{o2}}
③ {{o3}}
④ {{o4}}
⑤ {{o5}}
======================

지금 당장 필요한 것은, 지문을 읽고 선택지 ⑤에 들어갈 문장을 만드는 것이다. 이것은 지문에서 언급된 정보 중에서 ①번, ②번, ③번, ④번에 담긴 정보 이후에 가장 먼저 언급된 사실적 정보를 담도록 한다. 
선택지와 지문에 적힌 내용이 동일하지 않도록 의미는 동일하더라도 표현과 문장구조를 고쳐 써야 한다. 20단어 이내의 영어 문장 하나로 써라.
다른 설명을 추가하는 것은 금지된다. 번호나 다른 마킹도 금지된다. 오직 네가 만든 문장만을 출력하라.`,
conste: `다음 영어지문의 내용과 일치하지 않는 것을 찾는 문제의 해설을 작성해야 한다. 답변에 대한 설명은 하지말고 아래 예시의 포맷에 맞추어 주어진 문제를 풀고 그에 대한 해설을 작성해 출력하라.

===포맷===
정답: circled number
"{정답과 관련있는 지문 내 문장 또는 어구}"({앞 어구에 대한 한국어 해석})라고 하였으므로, {정답번호}는 글의 내용과 일치하지 않는다.
===예시===
정답: ⑤
"Do not underestimate yourself so that others can't, either"(다른 사람도 너를 과소평가할 수 없도록 너 자신을 과소평가하지마라)라고 하였으므로 ⑤는 글의 내용과 일치하지 않는다.
===네가 해설을 만들어야할 문제===
{{p}}`,
};
