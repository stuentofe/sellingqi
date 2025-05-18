// pages/api/grammar.js (또는 api/grammar.js)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text: passage } = req.body;  // summary.js처럼 여기서 text를 받아서 passage로 할당
  if (!passage || typeof passage !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing passage' });
  }

  try {
    const result = await generateGrammarProblem(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('Grammar API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate grammar problem' });
  }
}

// 기존 grammar.js 내 함수들 재사용 (필요시 아래 함수들도 함께 넣거나 import로 관리)
async function generateGrammarProblem(passage) {
  console.log('[START] generateGrammarProblem');
  console.log('입력 지문:', passage);

  if (!passage || typeof passage !== 'string') {
    throw new Error('Invalid or missing passage');
  }

  const result = await generateGrammarErrorQuestion(passage);
  console.log('[END] generateGrammarProblem - result:', result);
  return result;
}

const priorityTags = ['a', 'd', 'e', 'j', 'r'];

const inlinePrompts = {
  tagSelection_group: `You are part of a grammar question generation system. 
Never respond in conversational form. Output only the result.

The following grammar tags are defined as follows:
{{tagList}}

If the sentence below contains one of the listed grammar elements, return the corresponding letter only, without any puntuation. (e.g. a).
If none are present, return 'none'.

Sentence: {{s}}`,
  
extend: `You are part of a grammar question generation system.
Never respond in conversational form. Output only the result.

Add coherent, logically consistent, and stylistically similar content to the passage below to ensure it contains at least 5 complete English sentences.

Keep the tone and topic consistent with the original.

{{p}}`,


mark: `You are part of a grammar question generation system.
Never respond in conversational form. Output only the result.

Your task is to identify exactly one word or phrase in the sentence that matches the grammar category "{{tagName}}" (tag code: {{t}}) according to the rule provided below. Wrap only that part in angle brackets < >.

Rule: {{rule}}

Sentence: {{s}}

Output the full sentence, preserving all original text, and mark only the matched part with angle brackets. Only one set of brackets should be used.`,


  corrupt: `You are part of a grammar question generation system.
Never respond in conversational form. Output only the grammatically incorrect sentence.

Your task is to alter the word or phrase inside the angle brackets (< >) in the given sentence to make the sentence grammatically incorrect.
The type of grammatical error should follow the instruction given below:
({{t}}): {{rule}}

According to the rule, replace the part inside < > with a grammatically incorrect version.
Output only the altered sentence with the modified part still enclosed in angle brackets <>. 


{{s}}`,

  explainCorrect: `You are part of a grammar question generation system.
Never respond in conversational form. Output only the result.
다음 문장은 어법상 옳다. 아래 지시에 따라 한 문장의 해설을 한국어로 작성하라. 단, 기존의 <> 표시는 삭제해야 한다.

지시: {{rule}}

문장: {{s}}`,

  explainWrong: `You are part of a grammar question generation system.
Never respond in conversational form. Output only the result.
다음 문장은 어법상 틀리다. 아래 지시에 따라 한 문장의 해설을 한국어로 작성하라. 단, 기존의 <>표시는 삭제해야 한다.

지시: {{rule}}

문장: {{s}}`,

  confirmStructure: `You are part of a grammar question generation system.
묻습니다: 다음 문장에 다음 어법 요소가 확실히 포함되어 있습니까? 포함되어 있으면 'yes', 아니면 'no'를 출력하세요. 어법요소: {{tagName}} 

문장: {{s}}`,

verbMark: `You are part of a grammar question generation system.
Never respond in conversational form. Output only the result.

From the given sentence, review all words in the sentence except modal verbs, articles, and nouns. Select one word that is typically considered challenging, and wrap only that word in angle brackets < >. Output the full sentence, preserving all original text, and mark only the chosen word with angle brackets. Only one set of brackets should be used.  

Sentence: {{s}}`

};


const grammarTagNames = {
  a: 'number agreement between a lengthy subject and a verb',
  b: `an adverb ending with "-ly" suffix that modifies a verb`,
  c: 'participial clause',
  d: `passive voice(be + p.p.)`,
  e: `a relative pronoun which that immediately follows a preposition as in "in which"`,
  f: 'result clause introduced by <so ... that> (e.g. He is so tall that he can reach the top shelf)',
  g: 'dummy-it with extrapositon of an infinitive',
  h: 'participle that modifies a noun',
  i: 'to-infinitive expressing purpose or result',
  j: `<it ~ that ...> 강조구문`,
  k: `<by + v-ing> 구문 (e.g. You can learn by listening carefully.)`,
  m: '관계부사 where',
  n: 'an interrogative word',
  o: `a complementizer "that" (not a relative pronoun 'that') following a noun such as fact, belief, etc.`,
  p: 'a causative verb, "make," "have," or "let"',
  q: `"few" used as a subject`,
  r: `대동사 as in "He did not dance, but she did"`,
  s: 'one of the following three: during, despite, because of',
  t: `relfexives such as himself, themselves, etc.`,
  u: `"as" followed by a clause (subject + verb)`,
  v: `listing of two or more items as in "a, b, c, and d"`,
  w: 'an adjective as an object complement',
  x: 'one of the following three: what, that, or whether',
  y: `a string of "that of" or "those of"`
};

const tagGroups = {
  high: ['a', 'd', 'e'],
  midA: ['j', 'r', 'w', 'x'],
  midB: ['b', 'c', 't'],
  lowA: ['f', 'g', 'h', 'i', 'k'],
  lowB: ['l', 'm', 'n', 'o', 'p'],
  lowC: ['q', 's', 'u', 'v', 'y']
};

const grammarBracketRules = {
  a: `Bracket only the verb (that agrees in number with the lengthy subject). For example, the woman who teaches our kids <walks> to school every day.`,
  b: `Bracket only the adverb (that modifies the verb). For example, he ran <quickly> to catch the bus.`,
  c: `Bracket only the participle (that functions as an adverbial clause). For example, <Smiling>, she opened the door.`,
  d: `Bracket only the passive verb phrase (be + past participle). For example, the book <was written> by a famous author.`,
  e: `Bracket only the preposition + the relative pronoun together. For example, the car, <in which> a cat was lying, was a black SUV.`,
  f: `Bracket only the conjunction (that) introducing the result clause. For example, she was so tired <that> she fell asleep at her desk.`,
  g: `Bracket only the infinitive phrase (to + verb) acting as the logical subject. For example, it is important <to drink> enough water.`,
  h: `Bracket only the participle (used as an adjective modifying a noun). For example, we saw the <broken> window.`,
  i: `Bracket only the infinitive (that shows purpose or result). For example, he studies hard <to pass> the exam.`,
  j: `Bracket only the word (that) introducing the cleft clause. For example, it was John <that> broke the window.`,
  k: `Bracket only the gerund (that follows by in a causal phrase). For example, you can improve your English by <reading> every day.`,
  l: `Bracket only the gerund (that functions as the subject). For example, <Swimming> is a good exercise.`,
  m: `Bracket only the relative adverb (where) introducing the clause. For example, this is the park <where> we played yesterday.`,
  n: `Bracket only the wh-word used in the indirect question. For example, I don’t know <how> he solved the problem.`,
  o: `Bracket only the word (that) introducing the noun clause. For example, the fact <that> he lied surprised me.`,
  p: `Bracket only the verb that follows the causative verb. For example, she made him <clean> his room.`,
  q: `Bracket only the verb that agrees in number with the determiner ‘few’. For example, Few <know> the truth about the story.`,
  r: `Bracket only the auxiliary verb (that replaces a previously stated verb). For example, she sings better than I <do>.`,
  s: `Bracket only the preposition phrase (during, despite, or because of). For example, we stayed indoors <because of> the rain.`,
  t: `Bracket only the reflexive pronoun (ending in -self or -selves). For example, he hurt <himself> while lifting weights.`,
  u: `Bracket only the conjunction (as) that introduces a clause. For example, <As> I was leaving, it started to rain.`,
  v: `Bracket only the last one among the listed items. For example, she smiled, waved and <left>.`,
  w: `Bracket only the adjective (used as an object complement). For example, the movie made her <happy>.`,
  x: `Bracket only the complementizer (what, that, or whether) introducing a clause. For example, I don’t know <whether> she will come.`,
  z: `Bracket only one word the sentence. For example, I don't know <whether> she will come.`,
  y: `Bracket only that or those in front of the preposition of. For example, "The grass of my house is greener than <that> of your house."`
};

const grammarCorruptRules = {
a: `Change the verb to create a subject-verb agreement error. (For example, from "she <walks> to school every day." to "she <walk> to school every day.")`,
  b: `Replace the adverb with an adjective. (For example, from "he ran <quickly> to catch the bus." to "he ran <quick> to catch the bus.")`,
  c: `If it's a present participle, change it to a past participle; if it's a past participle, change it to a present participle. (For example, from "<Smiling>, she opened the door." to "<Smile>, she opened the door.")`,
  d: `Replace the passive voice with the active voice. (For example, from "the book <was written> by a famous author." to "the book <wrote> by a famous author.")`,
  e: `Replace the combination of the preposition and the relative pronoun with just the relative pronoun. (For example, from "The car, <in which> a cat was lying, was a black SUV." to "The car, <which> a cat was lying, was a black SUV.")`,
  f: `<No rule>. (No incorrect version available.)`,
  g: `<No rule>. (No incorrect version available.)`,
  h: `Replace the participle with a wrong one. (For example, from "we saw the <broken> window." to "we saw the <breaking> window.")`,
  i: `<No rule>. (No incorrect version available.)`,
  j: `Replace "that" with "what". (For example, from "it was John <that> broke the window." to "it was John <what> broke the window.")`,
  k: `<No rule>. (No incorrect version available.)`,
  l: `Replace the gerund subject with a base verb. (For example, from "<Swimming> is a good exercise." to "<Swim> is a good exercise.")`,
  m: `Replace "where" with "which". (For example, from "this is the park <where> we played yesterday." to "this is the park <which> we played yesterday.")`,
  n: `Replace the wh-word with a wrong one. (For example, from "I don’t know <how> he solved the problem." to "I don’t know <what> he solved the problem.")`,
  o: `Replace "that" with "what". (For example, from "the fact <that> he lied surprised me." to "the fact <what> he lied surprised me.")`,
  p: `Replace the verb inside the brackets with an infinitive (to + verb). (For example, from "she made him <clean> his room." to "she made him <to clean> his room.")`,
  q: `Change the verb to a singular form. (For example, from "Few <know> the truth about the story." to "Few <knows> the truth about the story.")`,
  r: `If the verb is do/does/did, replace it with am/is/are/was/were; if it is am/is/are/was/were, replace it with do/does/did. (For example, from "she sings better than I <do>." to "she sings better than I <am>.")`,
  s: `<No rule>. (No incorrect version available.)`,
  t: `Replace the reflexive pronoun with a simple object personal pronoun. (For example, from "he hurt <himself> while lifting weights." to "he hurt <him> while lifting weights.")`,
  u: `<No rule>. (No incorrect version available.)`,
  v: `Replace the bracketed item with a grammatically incorrect form. (For example, from "she smiled, waved and <left>." to "she smiled, waved and <leaving>.")`,
  w: `Replace the adjective with an adverb. (For example, from "the movie made her <happy>." to "the movie made her <happily>.")`,
  x: `If it is "that" or "whether", replace it with "what"; if it is "what", replace it with "that" or "whether". (For example, from "I don’t know <whether> she will come." to "I don’t know <what> she will come.")`,
 y: `If it's "that," replace it with "those". If it's "those," replace it with "that." (For example, from "The grass of my house is greener than <that> of your house" to "The grass of my house is greener than <those> of your house.)`
};

const grammarCorrectRules = {
a: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
b: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
c: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
d: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
e: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
f: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
g: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
h: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
i: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
j: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
k: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
l: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
m: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
n: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
o: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
p: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
q: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
r: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
s: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
t: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
u: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
v: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
w: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
x: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`,
z: `"~의 ~이므로 어법상 옳다"라는 형식의 한국어로 설명한다.`
};

const grammarWrongRules = {
a: `"~이므로 ~를 ~로 고쳐야 한다"라는 형식의 한국어로 설명한다.`,
b: `"~이므로 ~를 ~로 고쳐야 한다"라는 형식의 한국어로 설명한다.`,
c: `"~이므로 ~를 ~로 고쳐야 한다"라는 형식의 한국어로 설명한다.`,
d: `"~이므로 ~를 ~로 고쳐야 한다"라는 형식의 한국어로 설명한다.`,
e: `"~이므로 ~를 ~로 고쳐야 한다"라는 형식의 한국어로 설명한다.`,
f: `"~이므로 ~를 ~로 고쳐야 한다"라는 형식의 한국어로 설명한다.`,
g: `"~이므로 ~를 ~로 고쳐야 한다"라는 형식의 한국어로 설명한다.`,
h: '15자 이내의 한국어로 설명한다.',
i: '15자 이내의 한국어로 설명한다.',
j: '15자 이내의 한국어로 설명한다.',
k: '15자 이내의 한국어로 설명한다.',
l: '15자 이내의 한국어로 설명한다.',
m: '15자 이내의 한국어로 설명한다.',
n: '15자 이내의 한국어로 설명한다.',
o: '15자 이내의 한국어로 설명한다.',
p: '15자 이내의 한국어로 설명한다.',
q: '15자 이내의 한국어로 설명한다.',
r: '15자 이내의 한국어로 설명한다.',
s: '15자 이내의 한국어로 설명한다.',
t: '15자 이내의 한국어로 설명한다.',
u: '15자 이내의 한국어로 설명한다.',
v: '15자 이내의 한국어로 설명한다.',
w: '15자 이내의 한국어로 설명한다.',
x: '15자 이내의 한국어로 설명한다.'
};

async function getTagFromGroup(sentence, groupTags) {
  const tagList = groupTags
    .map(t => `(${t}) ${grammarTagNames[t] || ''}`)
    .join(', ');
  const tag = await fetchInlinePrompt('tagSelection_group', { s: sentence, tagList });
  return tag.trim();
}

export async function generateGrammarErrorQuestion(passage) {
  let sentences = passage.match(/[^.!?]+[.!?]/g)?.map(s => s.trim()) || [];

  if (sentences.length < 5) {
    const extended = await fetchInlinePrompt('extend', { p: passage });
    sentences = extended.match(/[^.!?]+[.!?]/g)?.map(s => s.trim()) || [];
  }
  if (sentences.length < 5) {
    throw new Error('지문 확장 후에도 문장이 5개 이상 되지 않습니다.');
  }

  const indexed = sentences.map((text, i) => ({ id: `s${i+1}`, text, len: text.length }));

  const tagResults = [];
  const usedTags = new Set();

  async function assignTagToSentences(sentences, candidateTags, groupName) {
    for (const s of sentences) {
      if (tagResults.find(r => r.id === s.id)) continue; // 이미 태그 붙은 문장 제외
      const availableTags = candidateTags.filter(t => !usedTags.has(t));
      if (availableTags.length === 0) break;

      const tag = await getTagFromGroup(s.text, availableTags);
      if (tag && tag !== 'none') {
        const ok = await fetchInlinePrompt('confirmStructure', { s: s.text, tagName: grammarTagNames[tag.trim()] });
        if (ok.trim().toLowerCase() === 'yes') {
          tagResults.push({ ...s, tag, group: groupName });
          usedTags.add(tag);
          if (tagResults.length >= 5) break;
        }
      }
    }
  }

  // 1. High 그룹 시도
  await assignTagToSentences(indexed, tagGroups.high, 'high');

  // 2. Mid 그룹 시도 (중복 태그 방지 유지)
  if (tagResults.length < 5) {
    await assignTagToSentences(indexed, [...tagGroups.midA, ...tagGroups.midB], 'mid');
  }

  // 3. Low 그룹은 세 개 그룹으로 쪼개서 순차 처리
  const lowGroupsSplit = [tagGroups.lowA, tagGroups.lowB, tagGroups.lowC];
  for (const lowSubGroup of lowGroupsSplit) {
    if (tagResults.length >= 5) break;
    await assignTagToSentences(indexed, lowSubGroup, 'low');
  }

  // 4. z 태그로 부족분 채우기
  if (tagResults.length < 5) {
    const untagged = indexed.filter(s => !tagResults.find(r => r.id === s.id));
    for (const s of untagged) {
      if (tagResults.length >= 5) break;
      tagResults.push({ ...s, tag: 'z', group: 'z' });
    }
  }

  if (tagResults.length < 5) {
    throw new Error('어법 태그를 5개 확보하지 못했습니다.');
  }

  // marking 작업
  const marked = await Promise.all(
    tagResults.map(async ({ text, tag }) =>
      tag === 'z'
        ? fetchInlinePrompt('verbMark', { s: text })
        : fetchInlinePrompt('mark', {
            s: text,
            t: tag,
            tagName: grammarTagNames[tag],
            rule: grammarBracketRules[tag],
          })
    )
  );

  // 오답 문장 선택
  const INVALID = ['f', 'g', 'i', 'k', 's', 'u', 'z'];
  const candidates = marked
    .map((m, i) => ({ i, len: m.length, tag: tagResults[i].tag }))
    .filter(c => !INVALID.includes(c.tag));

  if (!candidates.length) throw new Error('오답으로 사용할 수 있는 태그가 없습니다.');
  const wrongIndex = candidates.reduce((a, b) => (b.len > a.len ? b : a)).i;

  const wrongTag = tagResults[wrongIndex].tag;
  const wrongMarked = marked[wrongIndex];
  const wrongSentence =
    wrongTag === 'z'
      ? wrongMarked
      : await fetchInlinePrompt('corrupt', { s: wrongMarked, t: wrongTag, rule: grammarCorruptRules[wrongTag] });

  const revisedMap = {};
  tagResults.forEach((r, i) => {
    revisedMap[r.id] = i === wrongIndex ? wrongSentence : marked[i];
  });

  const fullText = tagResults
    .map(({ id }) => {
      const rev = revisedMap[id];
      const mark = ['①', '②', '③', '④', '⑤'][tagResults.findIndex(r => r.id === id)];
      return rev.replace(/<([^>]+)>/, `${mark}<$1>`);
    })
    .join(' ');

  // 해설 생성 (오답 문장만)
  const explanations = await Promise.all(
    tagResults.map(async ({ tag }, i) => {
      if (i === wrongIndex) {
        const s = wrongSentence;
        const rule = grammarWrongRules[tag];
        return ['①', '②', '③', '④', '⑤'][i] + ' ' + (await fetchInlinePrompt('explainWrong', { s, rule }));
      } else {
        return '';
      }
    })
  );

  return {
    prompt: '다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?',
    problem: `다음 글의 밑줄 친 부분 중, 어법상 틀린 것은?\n\n${fullText}`,
    answer: ['①', '②', '③', '④', '⑤'][wrongIndex],
    explanation: `정답: ${['①', '②', '③', '④', '⑤'][wrongIndex]}\n${explanations.join('\n')}`,
  };
}




async function fetchInlinePrompt(key, replacements, model = 'gpt-4o') {
  let prompt = inlinePrompts[key];
  for (const k in replacements) {
    prompt = prompt.replace(new RegExp(`{{${k}}}`, 'g'), replacements[k]);
  }

  // ✅ 요청 전 프롬프트 확인
  console.log(`🟡 [GPT 요청] (${key})`);
  console.log(prompt);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 300
    }),
  });

  const data = await response.json();

  // ✅ GPT 응답 내용만 출력
  console.log(data.choices?.[0]?.message?.content);

  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
}
