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
    const result = await generateOrderingProblem(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('ordering API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate ordering question' });
  }
}

async function generateOrderingProblem(passage) {
  
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


 
  function getValid4ChunkCombinations(n) {
    const result = [];
    function dfs(current, sum) {
      if (current.length === 4 && sum === n) result.push([...current]);
      if (current.length >= 4 || sum >= n) return;

      const maxChunkSize = n >= 9 ? 3 : 2;
      for (let i = 1; i <= maxChunkSize; i++) {
        dfs([...current, i], sum + i);
      }
    }
    dfs([], 0);
    return result;
  }

  
  function chunkSentences(sentences, sizes) {
    const result = [];
    let index = 0;
    for (const size of sizes) {
      result.push(sentences.slice(index, index + size).join(' '));
      index += size;
    }
    return result;
  }

  
  function generateSingleOrderQuestion(o, p, q, r) {
    const perms = [
      ['a','c','b'], ['b','a','c'], ['b','c','a'],
      ['c','a','b'], ['c','b','a']
    ];
    const [la, lb, lc] = perms[Math.floor(Math.random() * perms.length)];
    const labels = { [la]: p, [lb]: q, [lc]: r };
    const reverse = { [p]: la, [q]: lb, [r]: lc };

    const lines = [];
    lines.push("주어진 글 다음에 이어질 글의 흐름으로 가장 적절한 것은?\n");
    lines.push(o + "\n");
    lines.push(`(A) ${labels.a}`);
    lines.push(`(B) ${labels.b}`);
    lines.push(`(C) ${labels.c}\n`);
    lines.push("① (A) - (C) - (B)");
    lines.push("② (B) - (A) - (C)");
    lines.push("③ (B) - (C) - (A)");
    lines.push("④ (C) - (A) - (B)");
    lines.push("⑤ (C) - (B) - (A)");

    const correctLabel = [reverse[p], reverse[q], reverse[r]].join('');
    const answerKey = {
      acb: 1, bac: 2, bca: 3, cab: 4, cba: 5
    };
    const circled = ["①", "②", "③", "④", "⑤"];
    lines.push(`\n정답: ${circled[answerKey[correctLabel] - 1]}`);

    return lines.join("\n");
  }

  
  function generateAllOrderQuestions(sentences) {
    if (sentences.length < 4) return [];
    const results = [];
    const combinations = getValid4ChunkCombinations(sentences.length);
    let count = 1;

    for (const sizes of combinations) {
      const chunks = chunkSentences(sentences, sizes);
      const [o, p, q, r] = chunks;
      const question = generateSingleOrderQuestion(o, p, q, r);
      results.push(question);
      count++;
    }

    return results;
  }

  
  const { passage: cleanPassage, asterisked } = extractAsteriskedText(passage);
  const sentences = splitParagraphIntoSentences(cleanPassage);
  const problems = generateAllOrderQuestions(sentences);

  if (problems.length === 0) {
    return {
      problem: null,
      answer: null,
      explanation: "문장 수가 부족하거나 문제 생성이 불가능합니다."
    };
  }

  for (const problem of problems) {
    const aiAnswer = await fetchPrompt('ordering_verification', {
      problem: problem
    });

    const match = problem.match(/정답: ([①-⑤])/);
    const correctAnswer = match?.[1];

    if (!aiAnswer || aiAnswer === '0') continue;
    if (aiAnswer === correctAnswer) {
      const e = await fetchPrompt('conste', { p: problem, correctAnswer });
      
      const circledChoices = ["①", "②", "③", "④", "⑤"];
      const orderStrings = ["ACB", "BAC", "BCA", "CAB", "CBA"];
      const orderIndex = circledChoices.indexOf(correctAnswer);
      const orderText = orderStrings[orderIndex]
        .split("")
        .map(ch => `(${ch})`)
        .join(" - ");


      const explanation = `정답: ${correctAnswer}\n${e} 따라서 주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은 ${correctAnswer} '${orderText}'이다.`; 
      return {
        problem: problem,
        answer: correctAnswer,
        explanation: explanation
      };
    }
  }

  return {
    problem: null,
    answer: null,
    explanation: "순서가 고정되지 않는 글입니다."
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
ordering_verification: `
다음은 지문의 올바른 순서를 찾는 문제입니다. 선택지 중 글의 흐름에 가장 잘 맞는 단 하나의 정답이 존재한다면 해당 번호를 선택지 기호 (①, ②, ...) 형태로 출력하세요. 다른 설명이나 마크, 표시는 모두 금지됩니다. 그냥 문자 그대로 선택지의 숫자기호만 적어야 합니다. 만약 어떤 순서도 자연스럽지 않거나, 자연스러운 순서가 두 개 이상이라고 판단될 경우, 아무런 설명이나 표시, 마크 없이 오직 숫자 0을 출력하세요. [매우중요!] 출력방식을 준수하세요. 

====풀어야 할 문제====
{{problem}}
==================
`,
  conste: `
다음은 문장 순서를 묻는 문제다. 올바른 정답이 왜 그렇게 되는지 해설을 작성해야 한다. 주어진 문장 다음에 정답 순서대로 (A), (B), (C) 구획이 이어져야 하는 이유를 각각 '~다' 체의 한국어 1문장으로 작성하라. (총 3문장) 네가 작성한 해설만을 출력하고, 다른 설명이나 마크, 표시 등은 일체 사용하는 것을 금지한다. 
====문제====
{{p}}
====정답====
{{correctAnswer}}

====포맷====
{제시문 이후 첫 구획 연결에 대한 설명} {두번째 구획 연결에 대한 설명} {세번째 구획 연결에 대한 설명}
====예시====
뇌의 서로 다른 부위가 서로 다른 종류의 감각 자극을 표현한다는 내용의 주어진 글 다음에는, 이에 대한 예시로 뇌 뒤쪽의 시각 피질에는 감각 자극 중 시각적 입력에 반응하는 뉴런이 있다는 내용의 (C)가 이어져야 한다. 그다음으로, (C)의 사례로부터 뇌의 각 부위에서 서로 다른 종류의 자극이 제시될 때 서로 다른 뉴런 그룹이 발화된다는 것을 일반화하는 (A)가 이어져야 한다. (A)의 뒷부분에서는 한 뉴런 그룹이 여러 뉴런 그룹의 입력에 반응할 수 있기 때문에 제시된 자극을 단순히 표현만 하는 것보다 훨씬 더 많은 일을 할 수 있다는 내용이 나오므로, 그 뒤에는 입력 뉴런이 표현하는 것을 결합된 형태로 나타낼 수 있다는 내용을 예시와 함께 설명하는 (B)가 이어지는 것이 자연스럽다. 
`
};
