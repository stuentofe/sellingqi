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
    const result = await generateSumQuestion(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('summary API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate summary question' });
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

async function generateSumQuestion(passage) {
  const { passage: mainPassage, asterisked } = extractAsteriskedText(passage);
  const p = mainPassage;


const summary = (await fetchInlinePrompt('sum1a', { p })).trim();
let s1 = (await fetchInlinePrompt('sum1b', { summary })).trim();

let tags = [...s1.matchAll(/[@#]([^\s.,!]+)/g)];

if (tags.length < 2 || !tags.some(t => t[0].startsWith('@')) || !tags.some(t => t[0].startsWith('#'))) {
  console.warn('sum1b failed to tag properly. Fallback activated. Original:', s1);

  const words = summary.match(/\b\w+\b/g) || [];

  const maxLen = Math.max(...words.map(w => w.length));
  const longestWords = [...new Set(words.filter(w => w.length === maxLen))];

  const positions = longestWords.map(word => ({
    word,
    start: summary.indexOf(word),
    end: summary.lastIndexOf(word)
  }));

  const first = positions.reduce((a, b) => (a.start < b.start ? a : b)).word;
  const last = positions
    .filter(pos => pos.word !== first)
    .reduce((a, b) => (a.end > b.end ? a : b), { word: '', end: -1 }).word;

  if (!first || !last) {
    throw new Error(`Fallback에서 태그할 단어가 부족합니다. summary: ${summary}`);
  }

  s1 = summary
    .replace(new RegExp(`\\b${first}\\b`), `@${first}`)
    .replace(new RegExp(`\\b${last}\\b`), `#${last}`);

  tags = [...s1.matchAll(/[@#]([^\s.,!]+)/g)];

  if (tags.length < 2) {
    throw new Error('Fallback tagging에도 실패했습니다: ' + s1);
  }
}

const c1 = tags.find(t => t[0].startsWith('@'))[1].trim();
const c2 = tags.find(t => t[0].startsWith('#'))[1].trim();
const c = `${c1}, ${c2}`;


  let s2 = s1
    .replace(/@([^\s.,!]+)/g, '(A)')
    .replace(/#([^\s.,!]+)/g, '(B)');

  s2 = s2
    .replace(/\b(a|an)\s+(?=\(A\))/gi, 'a(n) ')
    .replace(/\b(a|an)\s+(?=\(B\))/gi, 'a(n) ');


  // 2단계: 오답 생성
  const synA = await fetchInlinePrompt('sum2a1', { s2, c1 });
  const oppA = await fetchInlinePrompt('sum2a2', { s2, c1 });
  const synB = await fetchInlinePrompt('sum2b1', { s2, c2 });
  const oppB = await fetchInlinePrompt('sum2b2', { s2, c2 });

  const [w1, x1] = synA.trim().split('\n').map(w => w.trim()).slice(0, 2);
  const [y1, z1] = oppA.trim().split('\n').map(w => w.trim()).slice(0, 2);
  const [w2, x2] = synB.trim().split('\n').map(w => w.trim()).slice(0, 2);
  const [y2, z2] = oppB.trim().split('\n').map(w => w.trim()).slice(0, 2);

  const allOptions = [
    { text: `${c1}, ${c2}`, key: '정답', len: c1.length + c2.length },
    { text: `${w1}, ${y2}`, key: 'w', len: w1.length + y2.length }, // 유(A) + 반(B)
    { text: `${x1}, ${z2}`, key: 'x', len: x1.length + z2.length }, // 유(A) + 반(B)
    { text: `${y1}, ${w2}`, key: 'y', len: y1.length + w2.length }, // 반(A) + 유(B)
    { text: `${z1}, ${x2}`, key: 'z', len: z1.length + x2.length }  // 반(A) + 유(B)
  ];

  allOptions.sort((a, b) => a.len - b.len);

  const labels = ['①', '②', '③', '④', '⑤'];
  const choices = allOptions.map((opt, idx) => ({
    no: labels[idx],
    text: opt.text
  }));

  const correct = choices.find(choice => choice.text === `${c1}, ${c2}`)?.no || '①';

  // 3단계: 해설 생성
  const e1 = (await fetchInlinePrompt('sum3', { p, s: s2, c })).trim();
  const e2 = (await fetchInlinePrompt('sum4', { s: s1 })).trim()
    .replace(/\$(.*?)\$/g, (_, word) => `(A)${word}(${c1})`)
    .replace(/\%(.*?)\%/g, (_, word) => `(B)${word}(${c2})`);
  const e3 = (await fetchInlinePrompt('sum5', { w1, w2, x1, x2, y1, y2, z1, z2 })).trim();

  const defs = e3.split(',').map(d => d.trim());
  const [w3, w4, x3, x4, y3, y4, z3, z4] = defs;

  const wrongList = [
  { word: w1, meaning: w3 }, { word: w2, meaning: w4 },
  { word: x1, meaning: x3 }, { word: x2, meaning: x4 },
  { word: y1, meaning: y3 }, { word: y2, meaning: y4 },
  { word: z1, meaning: z3 }, { word: z2, meaning: z4 }
]
.sort((a, b) => a.word.length - b.word.length)
.map(({ word, meaning }) => `${word}(${meaning})`)
.join(', ');


  const explanation =
  `정답: ${correct}
${e1} 따라서 요약문이 '${e2}'가 되도록 완성해야 한다. [오답] ${wrongList}`;

  // 문제 출력 텍스트 조립
  const dot = '\u2026\u2026';
  const headerLine = `     (A)          (B)`; // 공백 포함
  const choiceLines = choices.map(choice => {
    const [a, b] = choice.text.split(',').map(s => s.trim());
    return `${choice.no} ${a}${dot}${b}`;
  }).join('\n');

  const problem =
`다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 가장 적절한 것은?\n\n${p.trim()}${asterisked ? '\n' + asterisked : ''}\n\n${s2.replace(/\(A\)/g, '<  (A)  >').replace(/\(B\)/g, '<  (B)  >')}\n\n${headerLine}\n${choiceLines}`;

  return {
    prompt: '다음 글의 내용을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 가장 적절한 것은?',
    problem,
    answer: correct,
    explanation
  };
}


const inlinePrompts = {
  sum1a: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer without labelling or numbering.

Summarize the following passage in a single sentence within 30 words.
Paraphrase so that the sentence consists of at least two clauses (subject + verb units). Write in the most concise way you can.

{{p}}`,

  sum1b: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer.

Below is a summary sentence.
Identify two core-content words—one from each clause—that are not everyday words and also not technical terms or jargon.
Mark them by prefixing one with @ and the other with #. (For example: People love @happiness, but tend to #avoid it.)

{{summary}}`,

  sum2a1: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer.

Below are a sentence and one of the words used in it.
Name two interchangeable synonyms of the given word that:
- fit naturally when replacing the original word in the sentence
- are commonly used in similar contexts

[Summary Sentence]
{{s1}}
[Correct Word for (A)]
{{c1}}

List the two words, one per line without any labelling or numbering.`,

  sum2a2: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer.

Below are a sentence and one of the words used in it.
Name two semantic opponents or contextually inappropriate words that:
- are nonetheless grammatically acceptable in the blank
- appear plausible at a surface structural level
- but strongly distort or contradict the original meaning

[Summary Sentence]
{{s1}}
[Correct Word for (A)]
{{c1}}

List the two words, one per line without any labelling or numbering.`,

  sum2b1: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer.

Below are a sentence and one of the words used in it.
Name two interchangeable synonyms of the given word that:
- fit naturally when replacing the original word in the sentence
- are commonly used in similar contexts

[Summary Sentence]
{{s1}}
[Correct Word for (B)]
{{c2}}

List the two words, one per line without any labelling or numbering.`,

  sum2b2: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer.

Below are a sentence and one of the words used in it.
Name two semantic opponents or contextually inappropriate words that:
- are nonetheless grammatically acceptable in the blank
- appear plausible at a surface structural level
- but strongly distort or contradict the original meaning

[Summary Sentence]
{{s1}}
[Correct Word for (B)]
{{c2}}

List the two words, one per line without any labelling or numbering.`,

  sum3: `You are part of an algorithm designed to generate English complete summary-type questions. 
ChatGPT must never respond in conversational form and should only output the required answer.

지문
{{p}}

위 지문의 요지를 한국어 '~라는 글이다'로 마무리되는 완성된 50음절 이내의 한 문장으로 작성하라. 50음절 이내로 작성하라.
`,

  sum4: `You are part of an algorithm designed to generate English complete summary-type questions. 
ChatGPT must never respond in conversational form and should only output the required answer.

{{s}}

위 요약문을 한국어로 번역하라. 단, @과 #은 삭제하며, 문체는 '~(이)다'를 사용하라.`,

  sum5: `You are part of an algorithm designed to generate English complete summary-type questions. 
ChatGPT must never respond in conversational form and should only output the required answer.

{{w1}}, {{w2}}, {{x1}}, {{x2}}, {{y1}}, {{y2}}, {{z1}}, {{z2}}

위 영어 단어들의 한국어 대응 뜻을 나열하라. 줄바꿈이나 별도의 목록 표기 없이, 한 줄로 작성한다.`
};

async function fetchInlinePrompt(key, replacements, model = 'gpt-4o') {
  let prompt = inlinePrompts[key];

  for (const k in replacements) {
    prompt = prompt.replace(new RegExp(`{{${k}}}`, 'g'), replacements[k]);
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 100
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'GPT 응답 실패');
  return data.choices[0].message.content.trim();
}
