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
    const result = await generateGrammarabcProblem(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('grammarabc API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate grammarabc problem' });
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


async function generateGrammarabcProblem(passage) {

  const { passage: cleanPassage, asterisked } = extractAsteriskedText(passage);

  const sentenceList = cleanPassage
    .split(/[.!?]\s+/)
    .filter(s => s.trim().length > 0)
    .map((text, idx) => ({ id: `original_${idx}`, text, index: passage.indexOf(text) }));

  const topThree = [...sentenceList]
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 3);

  topThree.sort((a, b) => a.index - b.index);

  let revisedPassage = cleanPassage;

  const A = await fetchPrompt('constA', { p: cleanPassage, s: topThree[0].text });
  const [A1, A2] = A.trim().split('\n').map(w => w.trim()).slice(0, 2);
  const s1Mod = topThree[0].text.replace(new RegExp(`\\b${A1}\\b`), `(A) [ ${A1} / ${A2} ]`);
  revisedPassage = revisedPassage.replace(topThree[0].text, s1Mod);

  const B = await fetchPrompt('constB', { p: revisedPassage, s: topThree[1].text });
  const [B1, B2] = B.trim().split('\n').map(w => w.trim()).slice(0, 2);
  const s2Mod = topThree[1].text.replace(new RegExp(`\\b${B1}\\b`), `(B) [ ${B1} / ${B2} ]`);
  revisedPassage = revisedPassage.replace(topThree[1].text, s2Mod);

  const C = await fetchPrompt('constC', { p: revisedPassage, s: topThree[2].text });
  const [C1, C2] = C.trim().split('\n').map(w => w.trim()).slice(0, 2);
  const s3Mod = topThree[2].text.replace(new RegExp(`\\b${C1}\\b`), `(C) [ ${C1} / ${C2} ]`);
  revisedPassage = revisedPassage.replace(topThree[2].text, s3Mod);
  
  const combos = [
  [A1, B1, C1], [A1, B1, C2], [A1, B2, C1], [A1, B2, C2],
  [A2, B1, C1], [A2, B1, C2], [A2, B2, C1], [A2, B2, C2]
];

  const correct = [A1, B1, C1];
  const wrongCombos = combos.filter(c =>
    !(c[0] === correct[0] && c[1] === correct[1] && c[2] === correct[2])
);
  const shuffledWrongs = wrongCombos.sort(() => Math.random() - 0.5).slice(0, 4);
  const allOptions = [...shuffledWrongs, correct].sort(() => Math.random() - 0.5);
  const circledNumbers = ['①', '②', '③', '④', '⑤'];
  const answerIndex = allOptions.findIndex(
  c => c[0] === correct[0] && c[1] === correct[1] && c[2] === correct[2]
);
  const choices = allOptions.map((c, i) => {
    return `${circledNumbers[i]} (A): ${c[0]} (B): ${c[1]} (C): ${c[2]}`;
});
  const answer = circledNumbers[answerIndex];
  const question = `(A), (B), (C)의 각 괄호 안에서 문맥에 맞는 낱말로 가장 적절한 것은?\n${revisedPassage}\n\n${choices.join('\n')}`;
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

  constA: `영어 지문을 읽고 글의 문맥상 낱말의 적절한 단어를 선택하도록 하는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
(A), (B), (C)의 각 괄호 안에서 문맥에 맞는 낱말로 가장 적절한 것은?
{{p}}
======================

지금 당장 필요한 것은, 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 두 개 중에 적절한 하나를 선택할 수 있도록 한 쌍을 만드는 작업이다. 
너는 아래 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 그것의 짝과 함께 출력해야 한다. 
출력결과에 대한 별도 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다.
네가 아래 문장에서 조건에 맞추어 선택한 단어와, 그 단어를 기준으로 생각해낸 짝 단어까지 총 두 단어를 각각 줄바꿈으로만 구분해 출력해야 한다.

======조건======
1. 지문의 수준에 비해 너무 낮은 단어는 배제한다.
2. 사람이나 지역, 단체의 이름과 같은 고유명사는 배제한다.
3. 낱말의 쓰임이 과연 적절한 것인지를 판단 할 때 아래 문장만 보아도 알 수 있는 것은 배제한다.
4. 아래 문장 뿐만 아니라 이전 문장과 이후 문장 등 지문의 전체 맥락을 고려해야 판단할 수 있을 만한 단어를 우선적으로 고려한다.
5. 단어 선택 후에는 그 낱말과 대비했을 때 그 자리에 대체될 수 없는 틀린 단어(반의어 또는 무관한 단어)를 생각해내서 출력한다.
===============

=====지문에 사용된 문장 중 하나인 다음 문장에서 단어를 선택하고, 그 단어의 틀린 어휘 짝을 생각해 내어 그 둘을 출력하라=====
{{s}}
`,

  constB: `영어 지문을 읽고 글의 문맥상 낱말의 적절한 단어를 선택하도록 하는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
(A), (B), (C)의 각 괄호 안에서 문맥에 맞는 낱말로 가장 적절한 것은?
{{p}}
======================

괄호 (A)까지는 마련되었지만 지금 당장 필요한 것은 괄호 (B)를 만들기 위해 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 두 개 중에 적절한 하나를 선택할 수 있도록 한 쌍을 만드는 작업이다. 
너는 아래 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 그것의 짝과 함께 출력해야 한다. 
출력결과에 대한 별도 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다.
네가 아래 문장에서 조건에 맞추어 선택한 단어와, 그 단어를 기준으로 생각해낸 짝 단어까지 총 두 단어를 각각 줄바꿈으로만 구분해 출력해야 한다.

======조건======
0. [중요!] 괄호 (A)에 이미 사용되었던 단어는 배제한다.
1. 지문의 수준에 비해 너무 낮은 단어는 배제한다.
2. 사람이나 지역, 단체의 이름과 같은 고유명사는 배제한다.
3. 낱말의 쓰임이 과연 적절한 것인지를 판단 할 때 아래 문장만 보아도 알 수 있는 것은 배제한다.
4. 아래 문장 뿐만 아니라 이전 문장과 이후 문장 등 지문의 전체 맥락을 고려해야 판단할 수 있을 만한 단어를 우선적으로 고려한다.
5. 단어 선택 후에는 그 낱말과 대비했을 때 그 자리에 대체될 수 없는 틀린 단어(반의어 또는 무관한 단어)를 생각해내서 출력한다.
===============

=====지문에 사용된 문장 중 하나인 다음 문장에서 단어를 선택하고, 그 단어의 틀린 어휘 짝을 생각해 내어 그 둘을 출력하라=====
{{s}}
`,


  constC: `영어 지문을 읽고 글의 문맥상 낱말의 적절한 단어를 선택하도록 하는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
(A), (B), (C)의 각 괄호 안에서 문맥에 맞는 낱말로 가장 적절한 것은?
{{p}}
======================

괄호 (A), (B)까지는 마련되었지만 지금 당장 필요한 것은 남은 괄호 (C)를 만들기 위해 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 두 개 중에 적절한 하나를 선택할 수 있도록 한 쌍을 만드는 작업이다. 
너는 아래 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 그것의 짝과 함께 출력해야 한다. 
출력결과에 대한 별도 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다.
네가 아래 문장에서 조건에 맞추어 선택한 단어와, 그 단어를 기준으로 생각해낸 짝 단어까지 총 두 단어를 각각 줄바꿈으로만 구분해 출력해야 한다.

======조건======
0. [중요!] 괄호 (A)에 이미 사용되었던 단어는 배제한다.
1. 지문의 수준에 비해 너무 낮은 단어는 배제한다.
2. 사람이나 지역, 단체의 이름과 같은 고유명사는 배제한다.
3. 낱말의 쓰임이 과연 적절한 것인지를 판단 할 때 아래 문장만 보아도 알 수 있는 것은 배제한다.
4. 아래 문장 뿐만 아니라 이전 문장과 이후 문장 등 지문의 전체 맥락을 고려해야 판단할 수 있을 만한 단어를 우선적으로 고려한다.
5. 단어 선택 후에는 그 낱말과 대비했을 때 그 자리에 대체될 수 없는 틀린 단어(반의어 또는 무관한 단어)를 생각해내서 출력한다.
===============

=====지문에 사용된 문장 중 하나인 다음 문장에서 단어를 선택하고, 그 단어의 틀린 어휘 짝을 생각해 내어 그 둘을 출력하라=====
{{s}}
`,

  conste: `다음 문맥상 적절한 어휘 고르기 문제의 해설을 작성해야 한다. 다른 설명은 덧붙이지 말고 아래 예시의 포맷에 맞추어 주어진 문제를 풀고 그에 대한 해설을 작성해 출력하라.

===포맷===
정답: circled number
(A) {선택지의 앞 문장이나 뒷 문장을 통한 근거}라고 하였으므로, '{정답이 들어간 어구의 해석}'라는 흐름이 자연스럽다. 따라서, {정답 어휘}(한국어 해석)가 적절하다. {오답 어휘}는 '한국어 해석'라는 뜻이다. (B), (C)도 같은 방식으로...
===예시===
정답: ⑤
(A) 문장 뒤에서 그 결과 타인들도 당신을 과소평가할 수 있다고 하였으므로 '너 자신을 과소평가해서는 안된다.'라는 흐름이 자연스럽다. 따라서, overestimate(과대평가하다)가 적절하다. underestimate는 '과소평가하다'라는 뜻이다. (B) 문장 앞에서 성공은 노력의 결과라고 강조하였으므로 '꾸준히 노력해야 한다.'라는 흐름이 자연스럽다. 따라서, diligence(성실함, 근면함)가 적절하다. laziness는 '게으름'이라는 뜻이다. (C) 문장 뒤에서, 우리는 환경을 보호해야 한다고 하였으므로 '재활용은 중요하다.'라는 흐름이 자연스럽다. 따라서, conservation(보존)이 적절하다. destruction은 '파괴'라는 뜻이다. 
===네가 해설을 만들어야할 문제===
{{p}}`

};
