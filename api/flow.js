// Vercel 배포용 API Route: 흐름과 무관한 문장 고르기
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const { text: passage } = req.body;
  if (!passage || typeof passage !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing passage' });
  }
  try {
    const result = await generateFlowProblem(passage);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Flow API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// RegExp 특수문자 이스케이프
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

async function generateFlowProblem(passage) {
  let p = passage;

  // 문장 분리 및 ID 부여
  let sentences = p.match(/[^.!?]+[.!?]/g) || [];
  if (sentences.length < 5) {
    const modifiedPassage = await fetchInlinePrompt('expand_to_five', { passage });
    p = modifiedPassage;
    sentences = p.match(/[^.!?]+[.!?]/g) || [];
  }

  // p1, p2, ..., pn 마킹
  const markedSentences = sentences.map((s, i) => ({ id: i + 1, text: s.trim(), marked: `p${i + 1}: ${s.trim()}` }));

  // 세 쌍 sn-1/sn, sn-2/sn-1, sn-3/sn-2 계산
  const n = markedSentences.length;
  const pairs = [
    [markedSentences[n - 2], markedSentences[n - 1]],
    [markedSentences[n - 3], markedSentences[n - 2]],
    [markedSentences[n - 4], markedSentences[n - 3]]
  ];

  const pairWithMinDiff = pairs.reduce((minPair, currentPair) => {
    const [m1, m2] = currentPair;
    const [min1, min2] = minPair;
    const diffCurrent = Math.abs(m1.text.length - m2.text.length);
    const diffMin = Math.abs(min1.text.length - min2.text.length);
    return diffCurrent < diffMin ? currentPair : minPair;
  });

  const [m, nSentence] = pairWithMinDiff;

  const r1 = await fetchInlinePrompt('extract_topic_word', { sentence: m.text });
  const r2 = await fetchInlinePrompt('extract_topic_word', { sentence: nSentence.text });

  const mainIdea = await fetchInlinePrompt('extract_main_idea', { passage: p });

  // m과 n의 평균 글자 수
  const q = Math.round((m.text.length + nSentence.text.length) / 2);

  const incoherentSentence = await fetchInlinePrompt('generate_incoherent_sentence', {
    r1,
    r2,
    main: mainIdea
  });

  const modifiedIncoherentSentence = await fetchInlinePrompt('refine_incoherent_sentence', {
    sentence1: m.text,
    sentence2: incoherentSentence,
    sentence3: nSentence.text
  });

  // incoherentSentence를 m과 n 사이에 삽입하여 새 문단 구성
  const finalSentences = [...sentences];
  const idxM = sentences.findIndex(s => s.trim() === m.text.trim());
  const idxN = sentences.findIndex(s => s.trim() === nSentence.text.trim());

  if (idxM !== -1 && idxN === idxM + 1) {
    finalSentences.splice(idxM + 1, 0, modifiedIncoherentSentence);
  }

  // 번호 매기기 및 incoherent 위치 찾기
  const labels = ['①', '②', '③', '④', '⑤'];
  const incoherentIdx = finalSentences.findIndex(s => s.trim() === modifiedIncoherentSentence.trim());
  const totalLen = finalSentences.length;

  const labeled = finalSentences.map((s, i) => {
    const labelIdx = i - (totalLen - 5);
    const label = labelIdx >= 0 ? labels[labelIdx] : null;
    return label ? `${label} ${s.trim()}` : s.trim();
  });

  const incoherentPassage = labeled.join(' ');
  const answer = labels[incoherentIdx - (totalLen - 5)];

  const explanationText = await fetchInlinePrompt('explain_incoherence', {
    answer,
    incoherentPassage
  });

  const explanation =
`정답: ${answer}
${explanationText}`;
  
  return {
    problem: `다음 글에서 전체 흐름과 관계 없는 문장은?\n\n${incoherentPassage}\n\n`,
    answer,
    explanation
  };
}

async function fetchInlinePrompt(key, replacements, model = 'gpt-4o') {
  let prompt = inlinePrompts[key] || '';
  for (const k in replacements) {
    prompt = prompt.replace(new RegExp(`{{${k}}}`, 'g'), replacements[k]);
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.3 })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
}

const inlinePrompts = {
  expand_to_five: `Do not say in conversational form. Only output the result. Add a sentence or sentences into the passage so that the following passage consists of five or more sentences. Output the resulting passage in one paragraph.\n\n{{passage}}`,

  extract_topic_word: `Do not say in conversational form. Only output the result. Tell me what the following sentence is talking about? Answer by choosing one of the words used in the sentence. Do not choose a proper noun. Answer in one word. No punctuation and no capitalization required. Sentence: {{sentence}}.`,

  extract_main_idea: `What is the main idea of the passage? Write within 15 words limit.\n\n{{passage}}`,

  generate_incoherent_sentence: `Write a sentence that includes {{r1}} and {{r2}} in that order, but that expresses an unrelated or off-topic idea compared to the following sentence. Sentence: {{main}}`,

  refine_incoherent_sentence: `대화 형식으로 대답하지말고, 요구한 질문에 대한 답만을 출력하라. 문장1과 문장3 사이에 흐름상 관련 없는 문장2를 넣어서, 전체 흐름과 무관한 문장을 고르도록 하는 문제를 제작하는 중이다. 문장2가 전체 흐름과 무관한 문장이 되도록 해야한다. 겉으로 보기에는 자연스러운 것처럼 착각할 수 있도록, 문장의 메시지는 그대로 유지하면서 문장 스타일만을 문장1과 문장3과 비슷하게 고쳐라. 또, 연결부사(Therefore, For example, In addition, In other words, On the other hand 같은 것)을 추가해 피상적인 관련성 함정을 추가하려고 한다. 여기에 맞춰 문장2의 수정본을 출력하라. 결과 문장(문장2의 수정본)만을 출력하고, 다른 기호나 설명은 금지한다.\n\n문장1: {{sentence1}}\n문장2: {{sentence2}}\n문장3: {{sentence3}}`,

  explain_incoherence: `대화체로 답하는 것은 금지된다. 요구한 요청에 대한 답만을 출력하라. 다음은 전체 흐름과 관계 없는 문장을 선택하는 문제이고, 그 문제의 정답이다. {{answer}}번 문장이 흐름과 관계 없는 문장인 이유를 해설하는 한국어 문장을 다음 틀에 맞추어 작성하라. 틀: \"~한 내용의 글이므로, ~라는 내용의 {{answer}}번은 전체 흐름과 관계가 없다.\" 문제: 다음 글의 전체 흐름과 관계 없는 것은? {{incoherentPassage}}`
};
