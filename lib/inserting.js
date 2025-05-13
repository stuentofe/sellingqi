// 문단을 문장 단위로 분리
export function splitParagraphIntoSentences(text) {
  return text
    .replace(/\r?\n/g, " ")
    .match(/[^.!?]+[.!?]+/g)
    ?.map(s => s.trim()) || [];
}

// 삽입형 문제 하나 생성
function generateInsertionProblem(sentences, insertIndex) {
  const n = sentences.length;
  const circled = ["①", "②", "③", "④", "⑤"];
  const given = sentences[insertIndex];
  const rest = sentences.slice(0, insertIndex).concat(sentences.slice(insertIndex + 1));
  const paragraph = [];
  let answer = null;

  if (n === 5) {
    // p1 ~ p5 → index 0 ~ 4
    for (let i = 0; i <= rest.length; i++) {
      if (i < 5) paragraph.push(circled[i]);
      if (i < rest.length) paragraph.push(rest[i]);
    }
    answer = circled[insertIndex]; // 정답: 제거된 문장의 앞 위치
  } else {
    // 문장 수가 6 이상인 경우
    const base = n - 6; // s(n-5) ~ s(n-1) → index base ~ base+4
    const labelMap = {};
    for (let i = base + 1; i <= base + 5; i++) {
      labelMap[i] = circled[i - (base + 1)];
    }

    for (let i = 0; i <= rest.length; i++) {
      if (labelMap[i]) paragraph.push(labelMap[i]);
      if (i < rest.length) paragraph.push(rest[i]);
    }

    answer = labelMap[insertIndex]; // 정답 위치는 제거된 문장의 앞 공간
  }

  return {
    text: `글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?\n\n${given}\n\n${paragraph.join(" ")}`,
    answer
  };
}

// 전체 삽입형 문제 생성
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
