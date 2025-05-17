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
    const result = await generateGrammarErrorQuestion(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('grammar API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate grammar question' });
  }
}

const priorityTags = ['a', 'd', 'e', 'j', 'r'];

const inlinePrompts = {
  extend: `You are part of a grammar question generation system.
Never respond in conversational form. Output only the result.

Add enough coherent content to make this passage contain at least 5 complete sentences.

{{p}}`,

  mark: `You are part of a grammar question generation system.
Never respond in conversational form. Output only the result.

From the following sentence, identify the part that corresponds to the grammar category ({{t}}) and rule ({{rule}}), and wrap it with < >.

{{s}}`,

  tagSelection: `You are part of a grammar question generation system.
Never respond in conversational form. Output only the result.
다음 문장에, 내가 나열한 어법 요소 중 하나 이상이 들어 있다면, 그 중에서 딱 하나만을 골라 그 기호를 답하라.{{exclude}} (단, (a), (d), (e), (j), (r)에 해당하는 어법요소가 있다면, 그것을 우선 선택한다.):
(a) 수일치, (b) 부사/형용사 구별, (c) 분사구문, (d) 태, (e) 관계사 전환, (f) so ~ that 구문, (g) 형식 목적어/진주어 구문, (h) 과거분사, (i) to부정사, (j) 강조 구문, (k) 전치사 뒤 동명사, (l) 동명사(문장 주어), (m) 관계부사, (n) 의문사 용법, (o) 동격 접속사, (p) 사역동사 용법, (q) 복수 취급 대명사, (r) 대동사, (s) 전치사 용법

문장: {{s}}`,

  corrupt: `You are part of a grammar question generation system.
Never respond in conversational form. Output only the result.
다음 문장의 <>안에 단어 또는 어구를 변형해서 문장을 어법적으로 틀리게 만들려고 한다. 틀리게 만드는 방식은 다음과 같다.
({{t}}): {{rule}}
그에 따라 틀린 문장으로 고친 후, 고친 부분에 <>를 똑같이 표시하고 출력하라.

{{s}}`,

  explainCorrect: `You are part of a grammar question generation system.
Never respond in conversational form. Output only the result.
다음 문장은 어법상 옳다. 아래 지시에 따라 한 문장의 해설을 한국어로 작성하라.

지시: {{rule}}

문장: {{s}}`,

  explainWrong: `You are part of a grammar question generation system.
Never respond in conversational form. Output only the result.
다음 문장은 어법상 틀리다. 아래 지시에 따라 한 문장의 해설을 한국어로 작성하라.

지시: {{rule}}

문장: {{s}}`
};

const grammarBracketRules = {
  a: 'Mark the verb that must agree with the subject.',
  d: 'Mark the passive verb form or its auxiliary.',
  e: 'Mark the relative pronoun or related structure that is transformed.',
  // ... 추가 정의 가능
};

const grammarCorruptRules = {
  a: 'Change the verb form so that it no longer agrees with the subject.',
  d: 'Change the passive to active or misuse the auxiliary verb.',
  e: 'Use an inappropriate relative pronoun.',
  // ... 추가 정의 가능
};

const grammarCorrectRules = {
  a: 'Explain why the verb agrees with the subject.',
  d: 'Explain why the passive form is appropriate in this context.',
  e: 'Explain why the chosen relative pronoun is grammatically correct.',
  // ... 추가 정의 가능
};

const grammarWrongRules = {
  a: 'Explain why the verb does not agree with the subject, and how it should be corrected.',
  d: 'Explain why the passive form is incorrect, and suggest the correct form.',
  e: 'Explain why the relative pronoun is incorrect, and what should be used instead.',
  // ... 추가 정의 가능
};

async function generateGrammarErrorQuestion(passage) {
  let extendedPassage = passage;
  const originalSentences = passage.match(/[^.!?]+[.!?]/g) || [];
  if (originalSentences.length < 5) {
    extendedPassage = await fetchInlinePrompt('extend', { p: passage });
  }

  const sentences = extendedPassage.match(/[^.!?]+[.!?]/g).map(s => s.trim());
  const indexed = sentences.map((s, i) => ({ id: `s${i + 1}`, text: s, len: s.length }));

  const selected = [...indexed].sort((a, b) => b.len - a.len).slice(0, 5).sort((a, b) => parseInt(a.id.slice(1)) - parseInt(b.id.slice(1)));

  const usedTags = [];
  const tagResults = [];

  for (let i = 0; i < selected.length; i++) {
    const exclude = usedTags.length > 0 ? ` 단, 이미 선택된 기호들인 (${usedTags.join(', ')})는 선택하지 말라.` : '';
    const tag = await fetchInlinePrompt('tagSelection', { s: selected[i].text, exclude });
    usedTags.push(tag);
    tagResults.push({ ...selected[i], tag });
  }

  const markedSentences = await Promise.all(
    tagResults.map(({ text, tag }) =>
      fetchInlinePrompt('mark', { s: text, t: tag, rule: grammarBracketRules[tag] })
    )
  );

  const lengths = markedSentences.map(s => s.length);
  const wrongIndex = lengths.indexOf(Math.max(...lengths));
  const wrongTag = tagResults[wrongIndex].tag;
  const wrongMarked = markedSentences[wrongIndex];

  const wrongSentence = await fetchInlinePrompt('corrupt', {
    s: wrongMarked,
    t: wrongTag,
    rule: grammarCorruptRules[wrongTag]
  });

  const revisedMap = {};
  tagResults.forEach((s, i) => {
    const text = i === wrongIndex ? wrongSentence : markedSentences[i];
    revisedMap[s.id] = text;
  });

  const fullText = indexed.map(({ id, text }) => {
    const revised = revisedMap[id];
    if (!revised) return text;
    const markIndex = Object.values(revisedMap).indexOf(revised);
    const marker = `(${['①','②','③','④','⑤'][markIndex]})`;
    return revised.replace(/<([^>]+)>/, `${marker} <$1>`);
  }).join(' ');

  const explanations = await Promise.all(tagResults.map(async ({ id, tag }, i) => {
    const sentence = i === wrongIndex ? wrongSentence : markedSentences[i];
    const rule = i === wrongIndex ? grammarWrongRules[tag] : grammarCorrectRules[tag];
    const key = i === wrongIndex ? 'explainWrong' : 'explainCorrect';
    return `${['①','②','③','④','⑤'][i]}(${tag}): ` + await fetchInlinePrompt(key, { s: sentence, rule });
  }));

  return {
    prompt: '다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?',
    problem: `다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?

${fullText}`,
    answer: ['①','②','③','④','⑤'][wrongIndex],
    explanation: `정답: ${['①','②','③','④','⑤'][wrongIndex]}
` + explanations.join('
')
  };
}

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
