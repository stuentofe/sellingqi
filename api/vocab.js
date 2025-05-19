// pages/api/vocab.js
// Vercel용 API Route for vocabulary problems

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const { text: passage } = req.body;
  if (!passage || typeof passage !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing passage' });
  }
  try {
    const result = await generateVocabProblem(passage);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Vocab API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// 전체 어휘 문제 생성 함수
async function generateVocabProblem(passage) {
  if (!passage || typeof passage !== 'string') {
    throw new Error('Invalid or missing passage');
  }

  const sentences = passage.match(/[^.!?]+[.!?]/g)?.map(s => s.trim()) || [];
  if (sentences.length < 5) {
    throw new Error('문장이 5개 미만입니다.');
  }

  const orderedSentences = sentences.map((text, i) => ({ id: `s${i + 1}`, text, length: text.length }));

  const top5 = [...orderedSentences]
    .sort((a, b) => b.length - a.length)
    .slice(0, 5);

  const top5Ids = new Set(top5.map(s => s.id));
  const rest = orderedSentences.filter(s => !top5Ids.has(s.id));
  const markedMap = new Map();

  await tryMarking('adjective', top5, markedMap);
  if (markedMap.size < 5) await tryMarking('verb', top5, markedMap);
  if (markedMap.size < 5) await tryMarking('adjective', rest, markedMap);
  if (markedMap.size < 5) await tryMarking('verb', rest, markedMap);

  if (markedMap.size < 5) {
    const unmarkedTop5 = top5.filter(s => !markedMap.has(s.id));
    for (const s of unmarkedTop5) {
      const forced = await fetchInlinePrompt('forcedMarking', { s: s.text });
      if (forced.includes('<')) {
        markedMap.set(s.id, { text: forced, source: 'forced' });
      }
      if (markedMap.size >= 5) break;
    }
  }

  if (markedMap.size < 5) {
    throw new Error('어휘 마킹된 문장을 5개 확보하지 못했습니다.');
  }

  const selected = [...markedMap.entries()].slice(0, 5);
  const adjectiveMarked = selected.filter(([_, v]) => v.source === 'adjective');
  const verbMarked = selected.filter(([_, v]) => v.source === 'verb');

  let corruptEntry;
  if (adjectiveMarked.length > 0) {
    corruptEntry = adjectiveMarked[Math.floor(Math.random() * adjectiveMarked.length)];
  } else if (verbMarked.length > 0) {
    corruptEntry = verbMarked[Math.floor(Math.random() * verbMarked.length)];
  } else {
    throw new Error('유효한 corrupt 대상 문장을 찾지 못했습니다.');
  }

  const [corruptId, corruptData] = corruptEntry;
  const corrupted = await fetchInlinePrompt('corruptSentence', { s: corruptData.text });

  const markerMap = new Map();
  let markerIndex = 0;
  const fullText = orderedSentences.map(s => {
    if (!markedMap.has(s.id)) return s.text;
    const original = markedMap.get(s.id);
    const isCorrupt = s.id === corruptId;
    const appliedText = isCorrupt ? corrupted : original.text;
    const marker = ['①','②','③','④','⑤'][markerIndex++];
    markerMap.set(s.id, marker);
    return appliedText.replace(/<([^>]+)>/, `${marker}<$1>`);
  }).join(' ');

  const explanation = await fetchInlinePrompt('corruptExplain', { s: corrupted, original: corruptData.text });

  return {
    prompt: '다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?',
    problem: `다음 글의 밑줄 친 부분 중, 문맥상 낱말의 쓰임이 적절하지 않은 것은?\n\n${fullText}`,
    answer: markerMap.get(corruptId),
    explanation: `정답: ${markerMap.get(corruptId)}\n${explanation}`
  };
}

// 어휘 마킹 시도
async function tryMarking(type, sentenceList, markedMap) {
  const checkKey = type === 'adjective' ? 'adjectiveCheck' : 'verbCheck';
  const verifyKey = type === 'adjective' ? 'verifyAdjective' : 'verifyVerb';

  for (const { id, text } of sentenceList) {
    if (markedMap.has(id)) continue;
    const rawMarked = await fetchInlinePrompt(checkKey, { s: text });
    if (rawMarked.toLowerCase() === 'none' || !rawMarked.includes('<')) continue;

    const cleanMarked = removeCloseConjunctionMarks(rawMarked);
    const matchWords = [...cleanMarked.matchAll(/<([^>]+)>/g)].map(m => m[1]);
    const existingMarkedWords = new Set(
      Array.from(markedMap.values())
        .map(v => v.text.match(/<([^>]+)>/)?.[1]?.toLowerCase())
        .filter(Boolean)
    );
    const uniqueSorted = [...new Set(matchWords)]
      .filter(w => !existingMarkedWords.has(w.toLowerCase()))
      .sort((a, b) => b.length - a.length);

    for (const word of uniqueSorted) {
      const singleMarked = cleanMarked.replace(/<([^>]+)>/g, (match, w) =>
        w.trim().toLowerCase() === word.trim().toLowerCase() ? `<${w.trim()}>` : w.trim()
      );

      const isValidPOS = await fetchInlinePrompt(verifyKey, { s: singleMarked });
      if (!['yes', 'yes.', 'Yes.'].includes(isValidPOS.trim())) continue;

      const isDerivational = await fetchInlinePrompt('verifyDerivation', { s: singleMarked });
      if (!['no', 'no.', 'No.'].includes(isDerivational.trim())) continue;

      markedMap.set(id, { text: singleMarked, source: type });
      break;
    }

    if (markedMap.size >= 5) return;
  }
}

// 하이픈, 연접사 근접 마킹 제거
function removeCloseConjunctionMarks(sentence) {
  const normalized = sentence.replace(/<([^>]+)>[.,!?]/g, '<$1>');
  const tokens = normalized.split(/\s+/);
  const cleanTokens = [...tokens];

  const bannedWords = new Set([
    'good','bad','big','hot','cold','old','young',
    'happy','sad','new','tall','short','clean','dirty',
    'kind','nice','smart','dumb'
  ]);

  for (let i = 0; i < tokens.length; i++) {
    const match = tokens[i].match(/^<(.+)>$/);
    if (!match) continue;
    const word = match[1].toLowerCase();
    const prev2 = tokens[i-2]?.toLowerCase().replace(/[.,!?]/g,'');
    const prev1 = tokens[i-1]?.toLowerCase().replace(/[.,!?]/g,'');
    const next1 = tokens[i+1]?.toLowerCase().replace(/[.,!?]/g,'');
    const next2 = tokens[i+2]?.toLowerCase().replace(/[.,!?]/g,'');
    const context = [prev2, prev1, next1, next2];
    const hasConjunctionNearby = context.includes('and') || context.includes('or');
    const isLittleOrFewWithA = (word==='little'||word==='few') && prev1==='a';
    const isHyphenAttached = tokens[i+1]?.startsWith('-') || tokens[i-1]?.endsWith('-');
    const isInBannedWordList = bannedWords.has(word);
    if (hasConjunctionNearby || isLittleOrFewWithA || isHyphenAttached || isInBannedWordList) {
      cleanTokens[i] = match[1];
    }
  }

  return cleanTokens.join(' ');
}

// OpenAI 호출 래퍼
async function fetchInlinePrompt(key, replacements, model = 'gpt-4o') {
  let prompt = inlinePrompts[key];
  for (const k in replacements) {
    prompt = prompt.replace(new RegExp(`{{${k}}}`, 'g'), replacements[k]);
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 300 })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
}

// 프롬프트 템플릿(내용 별도 관리)
const inlinePrompts = {
  ensureFiveSentences: `Never respond in conversational form. Either add a sentence (or two, if required) or break a sentence (or two) into separate sentences in a way that the overall meaning of the passage does not change so that I can have a passage consisting of five individual sentences. Output the resulting passage only.`,
  adjectiveCheck: `Never respond in conversational form. Answer carefully after reading all the conditions below:\nIf the following sentence contains an adjective that (1) is an adjective by part of speech and (2) has a clear antonym, output the whole sentence again with the adjective wrapped with angle brackets <>.\nIf there is more than one such adjective, bracket each of them. If no such adjective appears in the sentence, output only: none.문장: {{s}}:`,
  verifyAdjective: `Is the word bracketed with <> in the following sentence an adjective? Answer only with yes or no.\n\nSentence: {{s}}`,
  verbCheck: `Never respond in conversational form. Answer carefully after reading all the conditions below:\nIf the following sentence contains a verb that (1) is a verb by part of speech and (2) has a direct antonym representing an opposite action (for example: increase/decrease, gain/lose, accept/reject, win/lose), output the whole sentence again with the verb wrapped with angle brackets <>.\nIf there is more than one such verb, bracket each of them. If no such verb appears in the sentence, output only: none.문장: {{s}}:`,
  verifyVerb: `Is the word bracketed with <> in the following sentence a verb? Answer only with yes or no.\n\nSentence: {{s}}`,
  verifyDerivation: `Does the bracketed word (including its derivational forms) appear twice or more in the sentence? Answer only with yes or no.\n\nSentence: {{s}}`,
  forcedMarking: `Never respond in conversational form. Answer carefully after reading all the conditions below:\nPick one and only one word that has an antonym, and output the whole sentence again with the selected word wrapped with angle brackets <>.\nSentence: {{s}}`,
  corruptSentence: `Never respond in conversational form. There is a sentence with one word bracketed with <>. The bracketed word has a clear antonym. Rewrite the sentence so that the bracketed word is replaced with its antonym, but the resulting sentence must still be grammtically well-formed. If the bracketed word is 'little' or 'few' that immediately follows, delete the 'a' in front of it. Output the whole sentence again with the substitution bracketed just like the original sentence. 문장: {{s}}:`,
  corruptExplain: `{{s}}이 틀렸기 때문에 {{original}}으로 고쳐야 하는 이유를 설명하는 해설을 한국어로 작성하라. 예: ~~인 글이다. 따라서, ~를 ~와 같은 낱말로 바꿔야 한다.`
};
