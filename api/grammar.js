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
(a) 긴 주어 다음에 동사 수일치, (b) 문장 수식하는 부사, (c) 분사구문, (d) 수동태, (e) 쉼표 다음 관계대명사, (f) so ~ that 구문, (g) 가주어-진주어(it-to부정사) 구문, (h) 명사 수식하는 과거분사, (i) 부사적용법의 to부정사, (j) it is ~ that 강조구문, (k) 전치사+동명사 구문, (l) 긴 동명사구 주어, (m) 관계부사 when이나 where, (n) how간접의문문, (o) 명사 다음 동격접속사 that, (p) 사역동사(have, let, make), (q) few가 사용된 주어, (r) 대동사가 사용되었음, (s) during, despite, because of 셋 중 하나

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
a: '주어와 수일치하는 동사를 딱 한 개 찾아서 <>로 감싼다. (예: A company consisting of competent workers <is> likely to succeed in a competitive market.)',
b: '문장에 사용된 동사 수식 부사를 딱 한 개 찾아 <>로 감싼다. (예: John and James differ <significantly>.)', 
c: '현재분사 또는 과거분사가 이끄는 분사구문을 찾아 그 분사(한 단어)를 <>로 감싼다. (예: <Feeling> tired, she went to bed early.)',
d: '수동태가 사용되었을 경우, be동사와 이어지는 과거분사를 함께 <>로 감싼다. 단, 만약 be동사와 과거분사 사이에 다른 어구가 있을 경우, be동사와 과거분사가 바로 인접할 수 있도록 문장을 수정한 뒤에 <>로 감싼다. (예: The book <was written> by Tom.)',
e: '쉼표 다음에 곧바로 이어지는 관계대명사 which가 있을 경우, which를 <>로 감싼다. (She bought a new phone, <which> was very expensive.)',
f: 'so ~ that 구문이 사용되었을 경우, that을 <>로 감싼다. (예: He was so tired <that> he fell asleep immediately.)',
g: '가주어-진주어 구문 (it ~ to-v)이 사용되었을 경우, to와 이어지는 동사원형을 <>로 감싼다. 단, to와 이어지는 동사원형 사이에 다른 어구가 있을 경우, to와 이어지는 동사원형이 바로 인접할 수 있도록 문장을 수정한 후에 <>로 감싼다. (예: It is important <to drink> enough water.)',
h: '명사를 수식하는 과거분사가 있는 경우, 과거분사를 <>로 감싼다. (예: The <broken> window was fixed yesterday.)',
i: '부사적 용법으로 사용된 to부정사가 있을 경우, to와 이어지는 동사원형을 <>로 감싼다. 단, to와 이어지는 동사원형 사이에 다른 어구가 있을 경우, to와 이어지는 동사원형이 바로 인접할 수 있도록 문장을 수정한 후에 <>로 감싼다. (예: She studied hard <to pass> the test.)',
j: '강조 구문 (It ~ that)이 사용되었을 경우, that을 <>로 감싼다. (예: It was John <that> broke the window.)',
k: '전치사 뒤 동명사가 이어지는 형식이 사용되었을 경우, 전치사 뒤에 이어지는 동명사를 <>로 감싼다. (예: She improved her English by <watching> movies.)',
l: '긴 동명사구 주어가 사용되었을 경우, 해당 동명사를 <>로 감싼다. (예: <Getting> up early in the morning every day is good for your health.)',
m: '관계부사 when또는 where가 사용되었을 경우, 관계부사를 <>로 감싼다. (예: This is the place <where> I met my friend.)',
n: 'how가 이끄는 간접의문문(의문사절)이 사용되었을 경우, how를 <>로 감싼다. (예: I don’t know <how> she solved the problem.)',
o: '앞선 명사의 내용을 설명하는 동격 접속사 that이 사용되었을 경우, 그 동격 접속사 that을 <>로 감싼다. (예: The fact <that> he passed the exam surprised everyone.)',
p: '사역동사(have, make, let)가 사용되었을 경우, 사역동사 뒤에 목적격보어로 온 동사원형 또는 분사를 <>로 감싼다. (예: She had her brother <carry> the bag.)',
q: 'few가 이끄는 명사(구)가 주어이고, 이어지는 동사가 현재시제일 경우, 동사를 <>로 감싼다. (예: Few students <understand> this concept.)',
r: '대동사가 사용되었을 경우, 대동사를 <>로 감싼다. (예: He didn’t finish the report, but she <did>.)',
s: 'during, because of, despite 중에 사용된 것이 있을 경우, 그것을 <>로 감싼다. (예: The game was canceled <because of> the heavy rain.)'


};

const grammarCorruptRules = {
a: '수일치가 틀리도록 만든다. (예: A company consisting of competent workers <is> likely to succeed in a competitive market. -> A company consisting of competent workers <are> likely to succeed in a competitive market.)',
b: '부사를 형용사로 바꾼다. (예: John and James differ <significantly>. -> John and James differ <significant>.)', 
c: '현재분사라면 과거분사로, 과거분사라면 현재분사로 바꾼다. (예: <Feeling> tired, she went to bed early. -> <Felt> tired, she went to bed early.)',
d: '능동태로 바꾼다. (예: The book <was written> by Tom. -> The book <wrote> by Tom.)',
e: '관계대명사가 아닌 인칭대명사로 바꾼다. (예: She bought a new phone, <which> was very expensive. -> She bought a new phone, <it> was very expensive.)',
f: 'that을 which으로 바꾼다. (예: He was so tired <that> he fell asleep immediately. -> He was so tired <which> he fell asleep immediately.)',
g: 'to부정사를 동사원형으로 바꾼다. (예: It is important <to drink> enough water. -> It is important <drink> enough water.)',
h: '과거분사를 현재분사로 바꾼다 (예: The <broken> window was fixed yesterday. -> The <breaking> window was fixed yesterday.)',
i: 'to부정사를 동사원형으로 바꾼다. (예: She studied hard <to pass> the test. -> She studied hard <pass> the test.)',
j: 'that 바로 앞에 명사가 있다면 which로 바꾸고, 그렇지 않다면 what으로 바꾼다. (예: It was John <that> broke the window. -> It was John <which> broke the window.)',
k: '동명사를 과거분사로 바꾼다. (예: She improved her English by <watching> movies. -> She improved her English by <watched> movies.)',
l: '동명사를 동사원형으로 바꾼다. (예: <Getting> up early in the morning every day is good for your health. -> <Get> up early in the morning every day is good for your health.)',
m: '관계부사를 which로 바꾼다. (예: This is the place <where> I met my friend. -> This is the place <which> I met my friend.)',
n: 'how를 what으로 바꾼다. (예: I don’t know <how> she solved the problem. -> I don’t know <what> she solved the problem.)',
o: 'that을 which로 바꾼다. (예: The fact <that> he passed the exam surprised everyone. -> The fact <which> he passed the exam surprised everyone.)',
p: 'to부정사로 바꾼다. (예: She had her brother <carry> the bag. -> She had her brother <to carry> the bag.)',
q: '동사를 단수 동사로 바꾼다. (예: Few students <understand> this concept. -> Few students <understands> this concept.)',
r: '대동사가 do(did, does)라면 are(was/were, is)로 바꾸고, are(was/were, is)라면 do(did, does)로 바꾼다. (예: He didn’t finish the report, but she <did>. -> He didn’t finish the report, but she <were>.)',
s: 'during, because of, despite 중에 사용된 것이 있을 경우, 그것을 각각, while, because, although로 바꾼다. (예: The game was canceled <because of> the heavy rain. -> The game was canceled <because> the heavy rain.)'

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
