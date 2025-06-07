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

function splitByWordCount(passage) {
  const words = passage.split(/\s+/);
  const chunkSize = Math.floor(words.length / 3);

  const part1 = words.slice(0, chunkSize).join(' ');
  const part2 = words.slice(chunkSize, chunkSize * 2).join(' ');
  const part3 = words.slice(chunkSize * 2).join(' ');

  return [part1, part2, part3].map((text, i) => ({
    id: `chunk_${i}`,
    text,
    index: passage.indexOf(text)
  }));
}

async function generateGrammarabcProblem(passage) {

  const { passage: cleanPassage, asterisked } = extractAsteriskedText(passage);

  const topThree = splitByWordCount(cleanPassage);

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
  const question = `(A), (B), (C)의 각 괄호 안에서 어법에 맞는 표현으로 가장 적절한 것은?\n${revisedPassage}\n\n${choices.join('\n')}`;
  const e = await fetchPrompt('conste', { A1, B1, C1, p: question });

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
 
  // Grammar 유형

  constA: `영어 지문을 읽고 글의 문맥상 낱말의 적절한 단어를 선택하도록 하는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
(A), (B), (C)의 각 괄호 안에서 어법에 맞는 표현으로 가장 적절한 것은?
{{p}}
======================

지금 당장 필요한 것은, 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 두 개 중에 적절한 하나를 선택할 수 있도록 한 쌍을 만드는 작업이다. 
너는 아래 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 그것의 짝과 함께 출력해야 한다. 
출력결과에 대한 별도 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다.
네가 아래 문장에서 조건에 맞추어 선택한 단어와, 그 단어를 기준으로 생각해낸 짝 단어까지 총 두 단어를 각각 줄바꿈으로만 구분해 출력해야 한다.

======조건======
1. function word 중에서 선택한다. [중요] 단, 단일 전치사는 배제한다.
2. 아래 학교 문법 난이도의 위계를 고려하여, 난이도 3, 4 중에서 선택하는 것이 좋다.
3. 단, 난이도 1은 우선 배제한다.
4. 오직 다음의 경우에 해당될 때만 붙어 있는 두 단어를 같이 선택할 수 있다. 그 외에는 낱개 단어만을 선택한다: 수동태(be + v-ed), 전치사 관계대명사 구문(전치사 +관계대명사)
===============

=====짝 단어 조건======
1. 아래 제시된 문장에 네가 선택한 단어를 쓰기에는 어법상 틀린 형태가 되도록 바꾼 것이 짝 단어다. 
2. 아래 학교 문법 난이도의 위계를 고려하여 선택된 단어이므로, 참조한 어법 요소를 알고 있어야 틀린 어법이라는 것을 찾을 수 있도록 변형한다. 
===============

======학교 문법 난이도의 위계=======
난이도 1: 시제(현재, 과거, 미래), 관사(a, the), be동사와 일반동사의 구분, 인칭대명사와 동사의 수 일치, 명사와 대명사의 수 일치, 형용사와 부사의 기본 차이, 기초 전치사(in, on, at, by 등), 조동사, 등위접속사(and, or, but)
난이도 2: 현재진행/과거진행, 비교급과 최상급, to부정사와 동명사의 기본적 구분과 쓰임
난이도 3: 의문사절, 수동태(be + p.p.), 목적어로 사용된 to부정사구/동명사구(enjoy v-ing/want to-v), 관계대명사 what, 명사절 that, 동격 that, 감정형용사 -ing/-ed 구분(interesting/interested)
난이도 4: 긴 주어(10단어 이상) 다음에 오는 3인칭 단수 동사, 분사구문, 전치사 + 관계대명사 구문, It ~ that 강조구문, 접속사와 전치사 구별, 가주어/가목적어 구문(It is important to V, I found it difficult to V 등), 복합관계사, 부정어 도치(Never have I seen such a thing.), 대동사
난이도 5: 혼합 가정법(If I had studied, I would be...), what 강조구문 등

=====지문의 앞부분에 해당하는 다음 부분에서 단어를 선택하고, 그 단어의 틀린 어휘 짝을 생각해 내어 그 둘을 출력하라=====
{{s}} (...)
`,

  constB: `영어 지문을 읽고 글의 문맥상 낱말의 적절한 단어를 선택하도록 하는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
(A), (B), (C)의 각 괄호 안에서 어법에 맞는 표현으로 가장 적절한 것은?
{{p}}
======================

괄호 (A)까지는 마련되었지만 지금 당장 필요한 것은 괄호 (B)를 만들기 위해 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 두 개 중에 적절한 하나를 선택할 수 있도록 한 쌍을 만드는 작업이다. 
너는 아래 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 그것의 짝과 함께 출력해야 한다. 
출력결과에 대한 별도 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다.
네가 아래 문장에서 조건에 맞추어 선택한 단어와, 그 단어를 기준으로 생각해낸 짝 단어까지 총 두 단어를 각각 줄바꿈으로만 구분해 출력해야 한다.

======조건======
0. [중요!] 괄호 (A)에 이미 사용되었던 단어는 배제한다.
1. function word 중에서 선택한다. [중요] 단, 단일 전치사는 배제한다.
2. 아래 학교 문법 난이도의 위계를 고려하여, 난이도 3, 4 중에서 선택하는 것이 좋다.
3. 단, 난이도 1은 우선 배제한다.
4. 오직 다음의 경우에 해당될 때만 붙어 있는 두 단어를 같이 선택할 수 있다. 그 외에는 낱개 단어만을 선택한다: 수동태(be + v-ed), 전치사 관계대명사 구문(전치사 +관계대명사)
===============

=====짝 단어 조건======
1. 아래 제시된 문장에 네가 선택한 단어를 쓰기에는 어법상 틀린 형태가 되도록 바꾼 것이 짝 단어다. 
2. 아래 학교 문법 난이도의 위계를 고려하여 선택된 단어이므로, 참조한 어법 요소를 알고 있어야 틀린 어법이라는 것을 찾을 수 있도록 변형한다. 
===============

======학교 문법 난이도의 위계=======
난이도 1: 시제(현재, 과거, 미래), 관사(a, the), be동사와 일반동사의 구분, 인칭대명사와 동사의 수 일치, 명사와 대명사의 수 일치, 형용사와 부사의 기본 차이, 기초 전치사(in, on, at, by 등), 조동사, 등위접속사(and, or, but)
난이도 2: 현재진행/과거진행, 비교급과 최상급, to부정사와 동명사의 기본적 구분과 쓰임
난이도 3: 의문사절, 수동태(be + p.p.), 목적어로 사용된 to부정사구/동명사구(enjoy v-ing/want to-v), 관계대명사 what, 명사절 that, 동격 that, 감정형용사 -ing/-ed 구분(interesting/interested)
난이도 4: 긴 주어(10단어 이상) 다음에 오는 3인칭 단수 동사, 분사구문, 전치사 + 관계대명사 구문, It ~ that 강조구문, 접속사와 전치사 구별, 가주어/가목적어 구문(It is important to V, I found it difficult to V 등), 복합관계사, 부정어 도치(Never have I seen such a thing.), 대동사
난이도 5: 혼합 가정법(If I had studied, I would be...), what 강조구문 등

=====지문의 중간 부분에 해당하는 다음에서 단어를 선택하고, 그 단어의 틀린 어휘 짝을 생각해 내어 그 둘을 출력하라=====
(...) {{s}} (...)
`,


  constC: `영어 지문을 읽고 글의 문맥상 낱말의 적절한 단어를 선택하도록 하는 객관식 문제를 만들려고 한다. 지금 현재 준비된 것은 다음과 같다.

======================
(A), (B), (C)의 각 괄호 안에서 어법에 맞는 표현으로 가장 적절한 것은?
{{p}}
======================

괄호 (A), (B)까지는 마련되었지만 지금 당장 필요한 것은 괄호 (C)를 만들기 위해 위 지문에 사용된 문장 중 하나(아래 제시되었음)에서 어휘 하나를 골라 두 개 중에 적절한 하나를 선택할 수 있도록 한 쌍을 만드는 작업이다. 
너는 아래 조건에 맞추어 아래 제시된 문장의 어휘 중 하나를 골라 그것의 짝과 함께 출력해야 한다. 
출력결과에 대한 별도 설명은 금지되며, 별도 마크나 숫자, 구두점도 금지된다.
네가 아래 문장에서 조건에 맞추어 선택한 단어와, 그 단어를 기준으로 생각해낸 짝 단어까지 총 두 단어를 각각 줄바꿈으로만 구분해 출력해야 한다.

======조건======
0. [중요!] 괄호 (A), (B)에 이미 사용되었던 단어는 배제한다.
1. function word 중에서 선택한다. [중요] 단, 단일 전치사는 배제한다.
2. 아래 학교 문법 난이도의 위계를 고려하여, 난이도 3, 4 중에서 선택하는 것이 좋다.
3. 단, 난이도 1은 우선 배제한다.
4. 오직 다음의 경우에 해당될 때만 붙어 있는 두 단어를 같이 선택할 수 있다. 그 외에는 낱개 단어만을 선택한다: 수동태(be + v-ed), 전치사 관계대명사 구문(전치사 +관계대명사)
===============

=====짝 단어 조건======
1. 아래 제시된 문장에 네가 선택한 단어를 쓰기에는 어법상 틀린 형태가 되도록 바꾼 것이 짝 단어다. 
2. 아래 학교 문법 난이도의 위계를 고려하여 선택된 단어이므로, 참조한 어법 요소를 알고 있어야 틀린 어법이라는 것을 찾을 수 있도록 변형한다. 
===============

======학교 문법 난이도의 위계=======
난이도 1: 시제(현재, 과거, 미래), 관사(a, the), be동사와 일반동사의 구분, 인칭대명사와 동사의 수 일치, 명사와 대명사의 수 일치, 형용사와 부사의 기본 차이, 기초 전치사(in, on, at, by 등), 조동사, 등위접속사(and, or, but)
난이도 2: 현재진행/과거진행, 비교급과 최상급, to부정사와 동명사의 기본적 구분과 쓰임
난이도 3: 의문사절, 수동태(be + p.p.), 목적어로 사용된 to부정사구/동명사구(enjoy v-ing/want to-v), 관계대명사 what, 명사절 that, 동격 that, 감정형용사 -ing/-ed 구분(interesting/interested)
난이도 4: 긴 주어(10단어 이상) 다음에 오는 3인칭 단수 동사, 분사구문, 전치사 + 관계대명사 구문, It ~ that 강조구문, 접속사와 전치사 구별, 가주어/가목적어 구문(It is important to V, I found it difficult to V 등), 복합관계사, 부정어 도치(Never have I seen such a thing.), 대동사
난이도 5: 혼합 가정법(If I had studied, I would be...), what 강조구문 등

=====지문의 마지막 부분에 해당하는 다음 부분에서 단어를 선택하고, 그 단어의 틀린 어휘 짝을 생각해 내어 그 둘을 출력하라=====
(...) {{s}}
`,

  conste: `다음 문맥상 적절한 어휘 고르기 문제의 해설을 작성해야 한다. 다른 설명은 덧붙이지 말고 아래 예시의 포맷에 맞추어 주어진 문제를 풀고 그에 대한 해설을 작성해 출력하라.

===포맷===
정답: circled number
(A) {관련 어법요소 설명}이므로, {오답}이 아닌 {정답}이 어법상 적절하다. (B), (C)도 같은 방식으로...
===예시===
정답: ⑤
(A) 이어지는 절이 완전하므로 what이 아닌 접속사 that이 어법상 적절하다. (B) 수식받는 명사 the person과 능동관계이므로 hit이 아닌 hitting이 어법상 적절하다. (C) 앞의 seek revenge를 대신하는 대동사이므로 are가 아닌 do가 어법상 적절하다. 

===네가 해설을 만들어야할 문제===
{{p}}
===정답===
(A): {{A1}} (B): {{B1}} (C): {{C1}}    
`
};
