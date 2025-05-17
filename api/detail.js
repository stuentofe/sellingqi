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
    const result = await generateDetailMismatchQuestion(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('detail API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate detail question' });
  }
}

async function generateDetailMismatchQuestion(passage) {
  // (0) 5문장 이상 확보
  let extendedPassage = passage;
  const initialSentences = passage.match(/[^.!?]+[.!?]/g) || [];
  if (initialSentences.length < 5) {
    extendedPassage = await fetchInlinePrompt('extend', { p: passage });
  }

  // (1) 문장 분리 및 번호 붙이기
  const sentences = extendedPassage.match(/[^.!?]+[.!?]/g).map(s => s.trim());
  const indexedSentences = sentences.map((s, i) => ({ id: `s${i + 1}`, text: s, len: s.length }));

  // (2) 긴 문장 5개 선택
  const selected = [...indexedSentences]
    .sort((a, b) => b.len - a.len)
    .slice(0, 5)
    .sort((a, b) => parseInt(a.id.slice(1)) - parseInt(b.id.slice(1))); // 원 순서 유지

  // (3) 각 문장에서 사실 정보 추출
  const factSummaries = await Promise.all(
    selected.map(({ text }) => fetchInlinePrompt('extractFact', { s: text }))
  );

  // (4) 무작위 선택지 하나 왜곡
  const wrongIndex = Math.floor(Math.random() * 5);
  const wrongOption = await fetchInlinePrompt('distortFact', {
    p: extendedPassage,
    f: factSummaries[wrongIndex],
  });

  // (5) 원래 문장 해석
  const originalSentence = selected[wrongIndex].text;
  const originalKorean = await fetchInlinePrompt('translateOriginal', { s: originalSentence });

  // (6) 해설 조립
    const explanation = `정답: ${labels[wrongIndex]}
${originalKorean.replace(/\.$/, '')}, (${originalSentence})라고 했으므로, 글의 내용과 일치하지 않는 것은 ${labels[wrongIndex]}이다.`;

  // (7) 문제 조립
  const topic = await fetchInlinePrompt('extractTopic', { p: extendedPassage });
  const labels = ['①', '②', '③', '④', '⑤'];
  const choices = factSummaries.map((f, i) => (i === wrongIndex ? wrongOption : f));
  const choiceLines = choices.map((c, i) => `${labels[i]} ${c}`).join('\n');

  const problem = `
'${topic}'에 관한 다음 글의 내용과 일치하지 <u>않는</u> 것은?\n${extendedPassage}\n\n${choiceLines}`;
  return {
    prompt: `'${topic}'에 관한 다음 글의 내용과 일치하지 _않는_ 것은?`,
    problem,
    answer: labels[wrongIndex],
    explanation,
  };
}

const inlinePrompts = {
  extend: `You are part of an English detail-question generation algorithm.
Never respond in conversational form. Output only the result.

The following passage contains fewer than 5 sentences.
Add enough logically consistent content so that the paragraph contains at least 5 complete sentences.

{{p}}`,

  extractTopic: `You are part of an English detail-question generation algorithm.
Never respond in conversational form. Output only the result.

Extract the main topic or concept from the following passage as a noun phrase in English, using 1 to 3 words only.

{{p}}`,

  extractFact: `You are part of an English detail-question generation algorithm.
Never respond in conversational form. Output only the result.

Translate the factual information from the following sentence into a complete Korean sentence.
It should be paraphrased and not a literal translation.
The sentence must end in a declarative form using '~이다' or '~다'.
Limit it to 20 characters if possible.
Use original English spelling for proper nouns.

{{s}}`,

  distortFact: `You are part of an English detail-question generation algorithm.
Never respond in conversational form. Output only the result.

The following Korean sentence is factually correct based on the passage.
Rewrite it so that it remains grammatically natural but contains factual inaccuracy when compared to the passage.

[Passage]
{{p}}
[Fact]
{{f}}`,

  translateOriginal: `You are part of an English detail-question generation algorithm.
Never respond in conversational form. Output only the result.

Translate the following English sentence into natural Korean.

{{s}}`
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
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'GPT 응답 실패');
  return data.choices[0].message.content.trim();
}
