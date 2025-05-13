export function splitParagraphIntoSentences(text) {
  return text
    .replace(/\r?\n/g, " ")
    .match(/[^.!?]+[.!?]+/g)
    ?.map(s => s.trim()) || [];
}

export function getValid4ChunkCombinations(n) {
  const result = [];
  function dfs(current, sum) {
    if (current.length === 4 && sum === n) result.push([...current]);
    if (current.length >= 4 || sum >= n) return;

    const maxChunkSize = n >= 9 ? 3 : 2;
    for (let i = 1; i <= maxChunkSize; i++) {
      dfs([...current, i], sum + i);
    }
  }
  dfs([], 0);
  return result;
}

export function chunkSentences(sentences, sizes) {
  const result = [];
  let index = 0;
  for (const size of sizes) {
    result.push(sentences.slice(index, index + size).join(' '));
    index += size;
  }
  return result;
}

export function generateSingleOrderQuestion(o, p, q, r) {
  const perms = [
    ['a','c','b'], ['b','a','c'], ['b','c','a'],
    ['c','a','b'], ['c','b','a']
  ];
  const [la, lb, lc] = perms[Math.floor(Math.random() * perms.length)];
  const labels = { [la]: p, [lb]: q, [lc]: r };
  const reverse = { [p]: la, [q]: lb, [r]: lc };

  const lines = [];
  lines.push("주어진 글 다음에 이어질 글의 흐름으로 가장 적절한 것은?\n");
  lines.push(o + "\n");
  lines.push(`(A) ${labels.a}`);
  lines.push(`(B) ${labels.b}`);
  lines.push(`(C) ${labels.c}\n`);
  lines.push("① (A) - (C) - (B)");
  lines.push("② (B) - (A) - (C)");
  lines.push("③ (B) - (C) - (A)");
  lines.push("④ (C) - (A) - (B)");
  lines.push("⑤ (C) - (B) - (A)");

  const correctLabel = [reverse[p], reverse[q], reverse[r]].join('');
  const answerKey = {
    acb: 1, bac: 2, bca: 3, cab: 4, cba: 5
  };
  const circled = ["①", "②", "③", "④", "⑤"];
  lines.push(`\n정답: ${circled[answerKey[correctLabel] - 1]}`);

  return lines.join("\n");
}

export function generateAllOrderQuestions(sentences) {
  if (sentences.length < 4) return ["문장 수 부족"];
  const results = [];
  const combinations = getValid4ChunkCombinations(sentences.length);
  for (const sizes of combinations) {
    const chunks = chunkSentences(sentences, sizes);
    const [o, p, q, r] = chunks;
    const question = generateSingleOrderQuestion(o, p, q, r);
    results.push(question);
  }
  return results;
}
