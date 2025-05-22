import fs from 'fs/promises';
import path from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text: passage } = req.body;
  if (!passage || typeof passage !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing passage' });
  }

  try {
    const result = await generateMniQuestion(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('mni API error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate main idea question' });
  }
}

function extractAsteriskedText(passage) {
  const match = passage.match(/^(.*?)(\*.+)$/s); // 줄바꿈 포함
  if (match) {
    return {
      passage: match[1].trim(),
      asterisked: match[2].trim()
    };
  } else {
    return {
      passage: passage.trim(),
      asterisked: null
    };
  }
}


async function generateMniQuestion(passage) {
  const { passage: cleanPassage, asterisked } = extractAsteriskedText(passage);
  let finalPassage = cleanPassage;

  const hasClaim = await fetchPrompt('mni2.txt', { p: cleanPassage });

  if (hasClaim.trim().toUpperCase() === 'NO') {
    const qraw = await fetchPrompt('mni10.txt', { p: cleanPassage });
    finalPassage = qraw.trim();
  }

  // asterisked가 있으면 줄바꿈 후 오른쪽 정렬로 덧붙이기
  if (asterisked) {
  finalPassage += `\n\n${asterisked}`;
}

  const c = (await fetchPrompt('mni3.txt', { p: finalPassage })).trim();
  const w = (await fetchPrompt('mni4.txt', { p: finalPassage, c })).trim();
  const x = (await fetchPrompt('mni5.txt', { p: finalPassage, c, w })).trim();
  const y = (await fetchPrompt('mni6.txt', { p: finalPassage, c, w, x })).trim();
  const z = (await fetchPrompt('mni7.txt', { p: finalPassage, c, w, x, y })).trim();

  const options = [c, w, x, y, z];
  const sorted = [...options].sort((a, b) => a.length - b.length);
  const labels = ['①','②','③','④','⑤'];
  const correctIndex = sorted.findIndex(opt => opt.trim() === c.trim());

  if (correctIndex === -1) {
    throw new Error('정답 위치를 찾을 수 없습니다. (정답이 선택지에 없음)');
  }

  const optionItems = sorted.map((opt, i) => `${labels[i]} ${opt}`);
  const answerNum = labels[correctIndex];
  const josa = ['이','가','이','가','가'][correctIndex];

  const e = (await fetchPrompt('mni8.txt', { p: finalPassage, c })).trim();
  const f = (await fetchPrompt('mni9.txt', { p: finalPassage, c })).trim();
  const explanationText = `${e} 이러한 글의 요지는, 문장 ${f}에서 가장 명시적으로 드러난다. 따라서, 글의 요지는 ${answerNum}${josa} 가장 적절하다.`;

  const problem =
`다음 글의 요지로 가장 적절한 것은?

${finalPassage.trim()}

${optionItems.join('\n')}`;

  const explanation =
`정답: ${answerNum}
${explanationText}`;

  return {
    prompt: '다음 글의 요지로 가장 적절한 것은?',
    problem,
    answer: answerNum,
    explanation
  };
}

async function fetchPrompt(file, replacements, model = 'gpt-4o') {
  const filePath = path.join(process.cwd(), 'api', 'prompts', file);
  let prompt = await fs.readFile(filePath, 'utf-8');

  for (const key in replacements) {
    prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), replacements[key]);
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'GPT 응답 실패');
  return data.choices[0].message.content.trim();
}
