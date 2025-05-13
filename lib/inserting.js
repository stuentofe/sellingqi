export function splitParagraphIntoSentences(text) {
  return text
    .replace(/\r?\n/g, " ")
    .match(/[^.!?]+[.!?]+/g)
    ?.map(s => s.trim()) || [];
}

function generateInsertionProblem(sentences, insertIndex) {
  const n = sentences.length;
  const isShort = n === 5;
  const given = sentences[insertIndex];
  const rest = sentences.slice(0, insertIndex).concat(sentences.slice(insertIndex + 1));
  const circled = ["①", "②", "③", "④", "⑤"];

  // 후보 문장 범위: 삽입 위치 후보 (p2~p(n-1)) → 실제 문장 사이 인덱스 기준
  const labelInsertPositions = [];
  for (let i = 1; i < rest.length; i++) {
    labelInsertPositions.push(i);
  }

  // 최대 5개만 사용
  const labelPositions = labelInsertPositions.slice(0, 5);
  const labelMap = new Map();
  labelPositions.forEach((pos, idx) => {
    labelMap.set(pos, circled[idx]);
  });

  // 정답 위치: s가 빠진 인덱스가 rest에서 빠진 자리에 대응될 때, 두 p 사이 위치에 삽입
  const actualInsertPosition = insertIndex; // 이게 rest에서 두 문장 사이 인덱스로도 동작
  const answer = labelMap.get(actualInsertPosition);

  // 문장 흐름 중에 선택지를 삽입해 단락 구성
  const paragraph = [];
  for (let i = 0; i < rest.length; i++) {
    if (labelMap.has(i)) {
      paragraph.push(labelMap.get(i));
    }
    paragraph.push(rest[i]);
  }

  return {
    text: `글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?\n\n${given}\n\n${paragraph.join(" ")}`,
    answer
  };
}

export function generateAllInsertionProblems(text) {
  const sentences = splitParagraphIntoSentences(text);
  const n = sentences.length;

  if (n < 5) return [{ error: "문장 수가 5개 이상이어야 합니다." }];

  const eligible =
    n === 5
      ? [0, 1, 2, 3, 4]              // s1 ~ s5 (인덱스 0~4)
      : Array.from({ length: 5 }, (_, i) => n - 6 + i);  // s(n−5) ~ s(n−1)

  return eligible.map((insertIndex, i) => {
    const problem = generateInsertionProblem(sentences, insertIndex);
    return {
      number: i + 1,
      problem: problem.text,
      answer: problem.answer
    };
  });
}
