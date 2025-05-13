// 문단을 문장 단위로 분리
export function splitParagraphIntoSentences(text) {
  return text
    .replace(/\r?\n/g, " ") // 줄바꿈 제거
    .match(/[^.!?]+[.!?]+/g) // 구두점 기준 분리
    ?.map(s => s.trim()) || [];
}

// 삽입형 문제 한 개 생성
function generateInsertionProblem(sentences, insertIndex) {
  const n = sentences.length;
  const isShort = n === 5;
  const baseP = isShort ? 0 : n - 5;

  // 제거된 문장
  const given = sentences[insertIndex];

  // 보기 구성용 문장 배열
  const rest = sentences.slice(0, insertIndex).concat(sentences.slice(insertIndex + 1));

  // 보기 번호 및 문장 배열
  const circled = ["①", "②", "③", "④", "⑤"];
  const numbered = [];

  for (let i = 0; i < 5; i++) {
    numbered.push(`( ${circled[i]} ) ${rest[baseP + i]}`);
  }

  // 정답: 제거된 문장의 앞 위치(pX)가 보기에 몇 번째인지
  const answerIndex = insertIndex - baseP;
  const answer = circled[answerIndex];

  return {
    text: `글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?\n\n${given}\n\n${numbered.join("\n")}`,
    answer
  };
}

// 전체 삽입형 문제 생성
export function generateAllInsertionProblems(text) {
  const sentences = splitParagraphIntoSentences(text);
  const n = sentences.length;

  if (n < 5) return [{ error: "문장 수가 5개 이상이어야 합니다." }];

  // 문장이 5개면 s0~s4 사용, 6개 이상이면 s(n-5)~s(n-1) 사용
  const eligible =
    n === 5
      ? [0, 1, 2, 3, 4]
      : Array.from({ length: 5 }, (_, i) => n - 5 + i);

  return eligible.map((insertIndex, i) => {
    const problem = generateInsertionProblem(sentences, insertIndex);
    return {
      number: i + 1,
      problem: problem.text,
      answer: problem.answer
    };
  });
}
