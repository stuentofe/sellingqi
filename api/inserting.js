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
    const result = await generateInsertingProblem(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('inserting API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate inserting question' });
  }
}

async function generateInsertingProblem(passage) {
  
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

function splitParagraphIntoSentences(text) {
  return (
    text
      .replace(/\r?\n/g, " ")
      .match(/.*?[.!?](?=\s+["“A-Z])/g)  
      ?.map(s => s.trim()) || []
  );
}

 
 async function generateInsertingProblem(passage) {
  function splitParagraphIntoSentences(text) {
    return text
      .replace(/\r?\n/g, " ")
      .match(/[^.!?]+[.!?]+/g)
      ?.map(s => s.trim()) || [];
  }

  function generateInsertionProblem(sentences, insertIndex) {
    const n = sentences.length;
    const circled = ["①", "②", "③", "④", "⑤"];
    const given = sentences[insertIndex];
    const rest = sentences.slice(0, insertIndex).concat(sentences.slice(insertIndex + 1));
    const paragraph = [];
    let answer = null;

    if (n === 5) {
      for (let i = 0; i <= rest.length; i++) {
        if (i < 5) paragraph.push(circled[i]);
        if (i < rest.length) paragraph.push(rest[i]);
      }
      answer = circled[insertIndex];
    } else {
      const base = n - 6;
      const insertionPoints = Array.from({ length: 5 }, (_, i) => base + i);
      const labelMap = {};
      insertionPoints.forEach((pIndex, i) => {
        labelMap[pIndex] = circled[i];
      });

      const pBefore = insertIndex;
      const idx = insertionPoints.indexOf(pBefore);
      answer = idx !== -1 ? circled[idx] : undefined;

      for (let i = 0; i <= rest.length; i++) {
        if (labelMap[i]) paragraph.push(labelMap[i]);
        if (i < rest.length) paragraph.push(rest[i]);
      }
    }

    return {
      text: `글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?\n\n${given}\n\n${paragraph.join(" ")}`,
      answer
    };
  }

  function generateAllInsertionProblems(text) {
    const sentences = splitParagraphIntoSentences(text);
    const n = sentences.length;

    if (n < 5) {
      return [{ error: "문장 수가 5개 이상이어야 합니다." }];
    }

    const eligible =
      n === 5
        ? [0, 1, 2, 3, 4]
        : Array.from({ length: 5 }, (_, i) => n - 6 + i);

    return eligible.map((insertIndex, i) => {
      const problem = generateInsertionProblem(sentences, insertIndex);
      return {
        number: i + 1,
        problem: problem.text,
        answer: problem.answer
      };
    });
  }

  const problems = generateAllInsertionProblems(passage);

  for (const { problem, answer } of problems) {
    if (!answer) continue;

    const aiAnswer = await fetchPrompt('ordering_verification', { problem });

    if (!aiAnswer || aiAnswer === '0') continue;
    if (aiAnswer === answer) {
      const e = await fetchPrompt('conste', { p: problem, correctAnswer: answer });

      const explanation = `정답: ${answer}\n${e} 따라서 주어진 문장이 들어가기에 가장 적절한 곳은 ${answer}이다.`;
      return {
        problem,
        answer,
        explanation
      };
    }
  }

  return {
    problem: null,
    answer: null,
    explanation: "삽입 위치가 고정되지 않는 글입니다."
  };
}

async function fetchPrompt(key, replacements = {}, model = 'gemini-2.0-flash') {
  const promptTemplate = inlinePrompts[key];
  if (!promptTemplate) {
    throw new Error(`Unknown prompt key: ${key}`);
  }

  let prompt = promptTemplate;
  for (const k in replacements) {
    prompt = prompt.replace(new RegExp(`{{${k}}}`, 'g'), replacements[k] ?? '');
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
          temperature: 0.2 // 안정적 정답 판별을 위해 낮춤
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
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      throw new Error('Gemini 응답이 비었거나 예상과 다른 형식입니다.');
    }

    // 응답 후처리 추가
    return rawText
      .trim()
      .replace(/^["']+(.*?)["']+$/, '$1') // 따옴표 제거
      .replace(/\*/g, ''); // 별표 제거

  } catch (err) {
    console.error('[Gemini API Error]', err);
    throw err;
  }
}


const inlinePrompts = { 
ordering_verification: `
다음은 제시된 문장의 올바른 위치를 찾는 문제입니다. 선택지 중 글의 흐름에 가장 잘 맞는 단 하나의 정답이 존재한다면 해당 번호를 선택지 기호 (①, ②, ...) 형태로 출력하세요. 다른 설명이나 마크, 표시는 모두 금지됩니다. 그냥 문자 그대로 선택지의 숫자기호만 적어야 합니다. 만약 어떤 순서도 자연스럽지 않거나, 자연스러운 순서가 두 개 이상이라고 판단될 경우, 아무런 설명이나 표시, 마크 없이 오직 숫자 0을 출력하세요. [매우중요!] 출력방식을 준수하세요. 

====풀어야 할 문제====
{{problem}}
==================
`,
  conste: `
다음은 제시된 문장의 올바른 위치를 찾는 문제입니다. 올바른 정답이 왜 아래 제시된 정답인지 설명하는 해설을 작성해야 한다. 주어진 문장 다음에 정답 순서대로 제시된 포맷과 예시를 참고하여 작성하고, 다른 설명이나 마크, 표시는 모두 금지된다. 네가 작성한 해설만을 출력하라.
====문제====
{{p}}
====정답====
{{correctAnswer}}

====포맷====
{정답 위치를 찾기 위한 구체적 설명 2-3문장}
====예시====
④ 뒤에서 소셜 미디어 플랫폼을 선택하는 것은 목표 기술에 잘맞는지에 근거하는 실용적인 결정이라는 내용이 나온 이후에 ⑤ 뒤에서는 이러한 플랫폼에서 학생들이 가상으로 의견을 제공하게 한다는 내용이 이어져 논리적 단절이 일어난다. 많은 소셜 미디어가 에세이 작성이나 격식 있는 발표와 같은 목표 기술에 잘맞지 않는다는 주어진 문장이 들어가면 ⑤ 다음의 내용이 역접 관계로 잘 이어져 단절이 해소된다.
`
};
