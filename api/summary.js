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
    const result = await generateSummaryProblem(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('summary API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate summary question' });
  }
}

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

async function generateSummaryProblem(passage) {
  const { passage: mainPassage } = extractAsteriskedText(passage);

  const s = await fetchPrompt('consts', { p: mainPassage });
  const ab = await fetchPrompt('constab', { s, p: mainPassage });
  const [a, b = ''] = ab.trim().split('\n');
  const blankeds = s.replace(a, '___(A)___').replace(b, '___(B)___');

  const as = await fetchPrompt('constsyn', { s, word: a });
  const ao = await fetchPrompt('constopp', { s, word: a });
  const bs = await fetchPrompt('constsyn', { s, word: b });
  const bo = await fetchPrompt('constopp', { s, word: b });

  const [aw1, aw2] = as.trim().split('\n').map(w => w.trim()).slice(0, 2);
  const [aw3, aw4] = ao.trim().split('\n').map(w => w.trim()).slice(0, 2);
  const [bw1, bw2] = bs.trim().split('\n').map(w => w.trim()).slice(0, 2);
  const [bw3, bw4] = bo.trim().split('\n').map(w => w.trim()).slice(0, 2);

  const choices = [
    `(A): ${a}, (B): ${b}`,
    `(A): ${aw1}, (B): ${bw4}`,
    `(A): ${aw2}, (B): ${bw3}`,
    `(A): ${aw3}, (B): ${bw2}`,
    `(A): ${aw4}, (B): ${bw1}`,
  ];

  const labeledChoices = choices.map((text, index) => ({
    text,
    index,
    length: text.length,
  }));

  labeledChoices.sort((a, b) => a.length - b.length);

  const labelSymbols = ['①', '②', '③', '④', '⑤'];
  const numberedChoices = labeledChoices.map((choice, i) => ({
    ...choice,
    label: labelSymbols[i],
  }));

  const answerIndex = numberedChoices.findIndex(c => c.index === 0);
  const answer = labelSymbols[answerIndex];

  const choicesText = numberedChoices.map(c => `${c.label} ${c.text}`).join('\n');

  const question = [
    '다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?',
    '',
    mainPassage,
    '',
    blankeds,
    '',
    choicesText
  ].join('\n');

  const e = (await fetchPrompt('conste', { p: question })).trim();

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
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 },
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
  consts: `자 다음은 영어 한단락 지문이 갖추는 글의 구조를 유형별로 정리한 것이다.
가장 밑에 제시된 영어 지문을 읽고, 그 지문의 유형을 파악해, 유형별 요약문 포맷에 맞추어 한 문장의 요약문을 영어로 작성하라.
- 설명은 금지한다.
- 마크를 사용하는 것도 금지한다.
영어로 된 완성된 요약문만을 출력하라.
네가 판단한 유형은 절대 언급하지 마라.

=========글의 구조 유형 및 요약문 포맷============================
1. 주제 - 예시                  | (the example explained) + (the theme stated)  	
2. 문제 - 해결                  | (the problem explained) + (the solution stated)	
3. 주장 - 근거                  | (the claim stated) + (the reason explained)	
4. 비교 - 대조                  | (an item explained) whereas (the other explained)	
5. 실험 - 결과 - 해석         | (the interpretation of the study) just as (the findings from the study)	
6. 원인 - 결과                   | (the result stated) + because (the cause stated)	
7. 통념 - 반박(새로운 견해) | Although (the conventional thinking) + (the new perspective stated)

=========네가 읽고 구조를 파악한 뒤 요약문을 만들어야 하는 지문===========
{{p}}
`,

  constab: `//// const a, b (첫줄 단어가 a고 두번째줄 단어가 b가 됨)

You are an assessment-item writer.  
Your task is to pick exactly two content words in the summary sentence that should be blanked out, so a test-taker must read the full passage to restore them.

=====Passage============
{P}     
======================

=====Summary sentence=====  
{S}
======================

=====Selection rules========  
(1) 후보는 내용어(명사·동사·형용사·부사)만.  
(2) 본문을 읽어야만 확정되는 단어여야 함.  
(3) 요약문만 보고 추측할 확률이 40 % 이상이면 제외.  
(4) 두 단어는 가능하면 서로 다른 핵심 단락(예: 원인 vs. 결과)에 대응.  

=====Output format========
Write the two chosen words in the order they appear in the summary, separated by a line break only.  
Output nothing else. Even A, B marks are not allowed in that the order of appearance of the two words suggest which is which.
`,


  constsyn: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer.

Below are a sentence and one of the words used in it.
Name two interchangeable synonyms of the given reference word that:
- fit naturally when replacing the original word in the sentence
- are commonly used in similar contexts

[Summary Sentence]
{{s}}
[Reference Word]
{{word}}

List the two words, one per line without any labelling or numbering.`,

  constopp: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer.

Below are a sentence and one of the words used in it.
Name two semantic opponents or contextually inappropriate words that:
- are nonetheless grammatically acceptable in the blank
- appear plausible at a surface structural level
- but strongly distort or contradict the original meaning

[Summary Sentence]
{{s}}
[Reference Word]
{{word}}

List the two words, one per line without any labelling or numbering.`,
 
  conste: `다음 영어지문의 요약문 빈칸 (A), (B)를 완성할 단어를 찾는 객관식 문제의 해설을 작성해야 한다. 다른 설명은 하지말고 아래 예시의 포맷에 맞추어 주어진 문제를 풀고 그에 대한 해설을 작성해 출력하라.

===포맷===
정답: 번호
(정답의 근거가 될 수 있는 내용)라는 내용의 글이다. 따라서, 요약문을 "완성된 영어 요약문(완성된 요약문의 우리말 해석)"로 완성해야 한다. [오답 어휘] (번호 차례대로 + (A), (B)차례대로)
===예시===
정답: ①
정체성은 행동의 반영이며, 믿는 정체성에 따라 행동한다는 내용의 글이다. 따라서 요약문을 "Your behaviors are usually a reflection of your identity(당신의 행동은 대개 당신의 정체성을 반영하는 것이다)."로 완성해야 한다. [오답 어휘] ② family(가족), skills(능력) ③ competence(능력), achievement(성취) ④ humour(유머), appearance(외모) ⑤ looks(외모), morality(도덕성)
=========

===네가 해설을 만들어야할 문제===
{{p}}`
};
