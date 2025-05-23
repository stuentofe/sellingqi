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

  // 요약문 생성
  let summary = (await fetchInlinePrompt('sum1a', { p })).trim();
  if (/\b(and|or)\b/i.test(summary)) {
    summary = (await fetchInlinePrompt('sum1a_post', { summary })).trim();
  }

  // 요약문 분리
  const [s1Raw, s2Raw] = summary.split(/(?<=[.!?])\s+/);

  // content words 추출
  const keywordListText = await fetchInlinePrompt('sum1c_keywords', { summary });
  const keywords = keywordListText.split('\n').map(w => w.trim()).filter(Boolean);

  // collocation 점수 확인
  const collocationRaw = await fetchInlinePrompt('sum1d_collocation_strength', {
    summary,
    words: keywords.join(', ')
  });
  const collocationScores = JSON.parse(collocationRaw);
  const filteredWords = keywords.filter(w => collocationScores[w] <= 0.8);

  // 핵심 어휘 선택
  const selected = await fetchInlinePrompt('sum1e_select_keywords', {
    summary,
    words: filteredWords.join(', ')
  });
  let [c1, c2] = selected.split(',').map(w => w.trim());

  // 두 문장 병합
  const merged = await fetchInlinePrompt('sum1g_merge_sentences', {
    s1: s1Raw,
    s2: s2Raw,
    c1,
    c2
  });

  let s1 = merged;

  // 지문 내 사용 단어 검사 및 유의어 교체
  function normalizeText(text) {
    return text.toLowerCase().replace(/[^\w\s]/g, '');
  }

  const normalizedPassage = normalizeText(p);
  const c1InPassage = normalizedPassage.includes(normalizeText(c1));
  const c2InPassage = normalizedPassage.includes(normalizeText(c2));

  let finalC1 = c1;
  let finalC2 = c2;

  if (c1InPassage) {
    finalC1 = (await fetchInlinePrompt('sum2a1', { s1, c1 })).trim().split('\n')[0].trim();
    s1 = await fetchInlinePrompt('sum1f_synonym_substitute', { s1, target: c1 });
  }

  if (c2InPassage) {
    finalC2 = (await fetchInlinePrompt('sum2b1', { s1, c2 })).trim().split('\n')[0].trim();
    s1 = await fetchInlinePrompt('sum1f_synonym_substitute', { s1, target: c2 });
  }

  const c = `${finalC1}, ${finalC2}`;

  // (A), (B) 치환
  s1 = s1.replace(new RegExp(`\\b${finalC1}\\b`), '(A)')
         .replace(new RegExp(`\\b${finalC2}\\b`), '(B)');
  s1 = s1
    .replace(/\b(a|an)\s+(?=\(A\))/gi, 'a(n) ')
    .replace(/\b(a|an)\s+(?=\(B\))/gi, 'a(n) ');

  // distractor 단어 생성
  const synA = await fetchInlinePrompt('sum2a1', { s1, c1: finalC1 });
  const oppA = await fetchInlinePrompt('sum2a2', { s1, c1: finalC1 });
  const synB = await fetchInlinePrompt('sum2b1', { s1, c2: finalC2 });
  const oppB = await fetchInlinePrompt('sum2b2', { s1, c2: finalC2 });

  const [w1, x1] = synA.trim().split('\n').map(w => w.trim()).slice(0, 2);
  const [y1, z1] = oppA.trim().split('\n').map(w => w.trim()).slice(0, 2);
  const [w2, x2] = synB.trim().split('\n').map(w => w.trim()).slice(0, 2);
  const [y2, z2] = oppB.trim().split('\n').map(w => w.trim()).slice(0, 2);

  const allOptions = [
    { text: `${finalC1}, ${finalC2}`, key: '정답', len: finalC1.length + finalC2.length },
    { text: `${w1}, ${y2}`, key: 'w', len: w1.length + y2.length },
    { text: `${x1}, ${z2}`, key: 'x', len: x1.length + z2.length },
    { text: `${y1}, ${w2}`, key: 'y', len: y1.length + w2.length },
    { text: `${z1}, ${x2}`, key: 'z', len: z1.length + x2.length }
  ];

  allOptions.sort((a, b) => a.len - b.len);
  const labels = ['①', '②', '③', '④', '⑤'];
  const choices = allOptions.map((opt, idx) => ({ no: labels[idx], text: opt.text }));
  const correct = choices.find(choice => choice.text === `${finalC1}, ${finalC2}`)?.no || '①';

  const e1 = (await fetchInlinePrompt('sum3', { p, s: s1, c })).trim();
  const e2 = (await fetchInlinePrompt('sum4', { s: s1 })).trim()
    .replace(/\$(.*?)\$/g, (_, word) => `(A)${word}(${finalC1})`)
    .replace(/\%(.*?)\%/g, (_, word) => `(B)${word}(${finalC2})`);

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

  const explanation = `정답: ${correct}\n${e1} 따라서 요약문이 '${e2}'가 되도록 완성해야 한다. [오답] ${wrongList}`;

  const dot = '\u2026\u2026';
  const headerLine = `     (A)          (B)`;
  const choiceLines = choices.map(choice => {
    const [a, b] = choice.text.split(',').map(s => s.trim());
    return `${choice.no} ${a}${dot}${b}`;
  }).join('


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


const inlinePrompts = {
  sum1a: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer without labelling or numbering.

Summarize the following passage in two concise sentences.
Each sentence should be no longer than 20 words.

{{p}}`,

  sum1a_post: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer without labelling or numbering.

If there are listings of two or more examples, use a single umbrella term instead, and output the revised version.
Find all such cases and make revisions for all of them.
Do not use conversational language or explain anything—just output the final revised version.

{{summary}}`,

  sum1c_keywords: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer.

Extract all content words from the following summary.
Exclude proper nouns (names of people, places, specific events) and technical jargon (e.g., medical or legal terms).
List one word per line. Do not include any numbering, punctuation, or explanations.

{{summary}}`,

  sum1d_collocation_strength: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer.

Below is a short passage and a list of content words extracted from it.

For each word, assess how strongly it collocates with surrounding words **in this specific passage context**, on a scale from 0.0 to 1.0.

- A score of 1.0 means the word is highly expected and naturally co-occurs with its surrounding words (strong collocation).
- A score of 0.0 means the word is weakly associated with its context and rarely co-occurs with its nearby words (weak collocation).
- Return the result in valid JSON format, like this:  
  { "word1": 0.8, "word2": 0.3, ... }

[Text]
{{summary}}

[Words]
{{words}}
`,

  sum1e_select_keywords: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer.

Below is a two-sentence summary and a list of eligible content words.
From the first sentence, select one word that best represents its key message.
From the second sentence, select one word that best represents its key message.

Only choose from the given word list.
Return exactly two words in this order: [first sentence word], [second sentence word].
Separate them with a comma, and output nothing else.

[Summary]
{{summary}}

[Eligible Words]
{{words}}
`,

  sum1g_merge_sentences: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer.

Below are two sentences and two selected content words, one from each sentence.

Merge the two sentences into a single sentence that is clear and concise.
Preserve the full original meaning of both.
Use natural connectors or restructuring as needed.

Do not add, omit, or change any ideas.
Do not modify the selected words in any way. Use them exactly as given, with no change in form or position.

[Sentence 1]
{{s1}}

[Sentence 2]
{{s2}}

[Selected Words]
{{c1}}, {{c2}}

`,
  
  sum1f_synonym_substitute: `You are part of an algorithm designed to generate English summary-type questions.
ChatGPT must never respond in conversational form and should only output the required answer.

Below is a summary sentence and a target word used in it.

Replace the target word with a synonym that fits the meaning and grammar within the sentence.
Change only the target word and leave the rest of the sentence exactly the same.
Output the revised sentence only, with no additional explanation or formatting.

[Sentence]
{{s1}}

[Target Word]
{{target}}
`,

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
