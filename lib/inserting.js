// lib/inserting.js

export function splitParagraphIntoSentences(text) {
  return text
    .replace(/\r?\n/g, " ")
    .match(/[^.!?]+[.!?]+/g)
    ?.map(s => s.trim()) || [];
}

export function getInsertionEligibleIndices(length) {
  if (length < 5) return [];
  const skipFront = Math.min(length - 5, 4);
  const skipBack = length - 5 - skipFront;
  const eligible = [];
  for (let i = skipFront; i < length - skipBack; i++) {
    eligible.push(i);
  }
  return eligible;
}

function findInsertionAnswer(sentences, rest, insertIndex) {
  let count = 0;
  for (let i = 0; i < insertIndex; i++) {
    if (rest.includes(sentences[i])) count++;
  }
  return count; // 0-based index → corresponds to ①–⑤
}

function generateInsertionProblem(sentences, insertIndex) {
  const given = sentences[insertIndex];
  const rest = sentences.slice(0, insertIndex).concat(sentences.slice(insertIndex + 1));
  const numbered = [];
  const circled = ["①", "②", "③", "④", "⑤"];

  for (let i = 0; i < 5; i++) {
    numbered.push(`( ${circled[i]} ) ${rest[i]}`);
  }

  const answerIndex = findInsertionAnswer(sentences, rest, insertIndex);
  const answer = circled[answerIndex];

  return {
    text: `글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?\n\n${given}\n\n${numbered.join("\n")}`,
    answer
  };
}

export function generateAllInsertionProblems(text) {
  const sentences = splitParagraphIntoSentences(text);
  const eligible = getInsertionEligibleIndices(sentences.length);
  if (eligible.length === 0) return [{ error: "문장 수가 5개 이상이어야 합니다." }];

  return eligible.map((idx, i) => {
    const problem = generateInsertionProblem(sentences, idx);
    return {
      number: i + 1,
      problem: problem.text,
      answer: problem.answer
    };
  });
}
