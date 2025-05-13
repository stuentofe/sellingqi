export function splitParagraphIntoSentences(text) {
  return text
    .replace(/\r?\n/g, " ")
    .match(/[^.!?]+[.!?]+/g)
    ?.map(s => s.trim()) || [];
}

function generateInsertionProblem(sentences, insertIndex) {
  const n = sentences.length;
  const circled = ["①", "②", "③", "④", "⑤"];
  const given = sentences[insertIndex];
  const rest = sentences.slice(0, insertIndex).concat(sentences.slice(insertIndex + 1));
  const paragraph = [];
  let answer = null;

  if (n === 5) {
    for (let i = 0; i <= rest.length; i++) {
      if (i < 5) paragraph.push(circled[i]);
      if (i < rest.length) paragraph.push(rest[i]);
    }
    answer = circled[insertIndex];
  } else {
    const base = n - 6;
    const insertionPoints = Array.from({ length: 5 }, (_, i) => base + i); // p(n-5) ~ p(n-1)
    const labelMap = {};
    insertionPoints.forEach((pIndex, i) => {
      labelMap[pIndex] = circled[i];
    });

    const pBefore = insertIndex; // index of sentence removed = pX
    const idx = insertionPoints.indexOf(pBefore);
    answer = idx !== -1 ? circled[idx] : undefined;

    for (let i = 0; i <= rest.length; i++) {
      if (labelMap[i]) paragraph.push(labelMap[i]);
      if (i < rest.length) paragraph.push(rest[i]);
    }
  }

  return {
    text: `글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?\n\n${given}\n\n${paragraph.join(" ")}`,
    answer
  };
}

export function generateAllInsertionProblems(text) {
  const sentences = splitParagraphIntoSentences(text);
  const n = sentences.length;

  if (n < 5) {
    return [{ error: "문장 수가 5개 이상이어야 합니다." }];
  }

  const eligible =
    n === 5
      ? [0, 1, 2, 3, 4]
      : Array.from({ length: 5 }, (_, i) => n - 6 + i);

  return eligible.map((insertIndex, i) => {
    const problem = generateInsertionProblem(sentences, insertIndex);
    return {
      number: i + 1,
      problem: problem.text,
      answer: problem.answer
    };
  });
}