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
  let paragraph = [];
  let answer = null;

  if (n === 5) {
    // p1 ~ p6 → insert positions: 0 ~ 5
    const labelMap = { 0: "①", 1: "②", 2: "③", 3: "④", 4: "⑤" };
    const insertionPoint = insertIndex + 1; // e.g. s2 → between p2 and p3 = index 2
    answer = labelMap[insertionPoint];

    for (let i = 0; i <= rest.length; i++) {
      if (i in labelMap) paragraph.push(labelMap[i]);
      if (i < rest.length) paragraph.push(rest[i]);
    }
  } else {
    // n ≥ 6 → use s(n-5) ~ s(n-1) as candidates
    const base = n - 6;
    const labelMap = {};
    for (let i = base + 1; i <= base + 5; i++) {
      labelMap[i] = circled[i - (base + 1)];
    }

    const insertionPoint = insertIndex;
    answer = labelMap[insertionPoint];

    for (let i = 0; i <= rest.length; i++) {
      if (i in labelMap) paragraph.push(labelMap[i]);
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
      ? [0, 1, 2, 3, 4] // s1 ~ s5
      : Array.from({ length: 5 }, (_, i) => n - 6 + i); // s(n-5) ~ s(n-1)

  return eligible.map((insertIndex, i) => {
    const problem = generateInsertionProblem(sentences, insertIndex);
    return {
      number: i + 1,
      problem: problem.text,
      answer: problem.answer
    };
  });
}
