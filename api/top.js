import fs from 'fs/promises';
import path from 'path';
import { callGPT } from './fetch-gpt.js';

function replaceTemplate(template, replacements) {
  return Object.entries(replacements).reduce(
    (result, [key, val]) => result.replace(new RegExp(`{{${key}}}`, 'g'), val),
    template
  );
}

async function loadPrompt(file) {
  const filePath = path.join(process.cwd(), 'api', 'prompts', file);
  return await fs.readFile(filePath, 'utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { passage } = req.body;
  if (!passage || typeof passage !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing passage' });
  }

  try {
    const p = passage;

    // 주제문 존재 여부 판단
    const hasClaim = await callGPT(replaceTemplate(await loadPrompt('top2.txt'), { p }));
    let finalPassage = p;
    if (hasClaim === 'NO') {
      const qraw = await callGPT(replaceTemplate(await loadPrompt('top10.txt'), { p }), 'gpt-4o');
      finalPassage = qraw.trim();
    }

    // 정답 생성 (GPT-4o)
    const c = (await callGPT(replaceTemplate(await loadPrompt('top3.txt'), { p: finalPassage }), 'gpt-4o')).trim();

    // 오답 4개 한번에 생성 후 개행 기준 분리
    const wrongRaw = await callGPT(replaceTemplate(await loadPrompt('top4.txt'), { p: finalPassage, c }), 'gpt-4o');
    const wrongOptions = wrongRaw.split('\n').map(opt => opt.trim()).filter(Boolean).slice(0, 4);

    const options = [c, ...wrongOptions];
    const sorted = [...options].sort((a, b) => a.length - b.length);
    const labels = ['①','②','③','④','⑤'];
    const correctIndex = sorted.findIndex(opt => opt === c);
    const optionItems = sorted.map((opt, i) => ({ label: labels[i], text: opt }));

    // 해설 생성
    const e = (await callGPT(replaceTemplate(await loadPrompt('top8.txt'), { p: finalPassage, c }), 'gpt-4o')).trim();
    const f = (await callGPT(replaceTemplate(await loadPrompt('top9.txt'), { p: finalPassage, c }))).trim();
    const answerNum = labels[correctIndex];
    const josa = ['이','가','이','가','가'][correctIndex];
    const explanation = `${e} 따라서, 글의 주제는 ${answerNum}${josa} 가장 적절하다.`;

    const body = `
      <p>${finalPassage}</p>
      <ul>
        ${optionItems.map(item => `<li>${item.label} ${item.text}</li>`).join('')}
      </ul>
    `;

    res.status(200).json({
      prompt: '다음 글의 주제로 가장 적절한 것은?',
      body,
      answer: answerNum,
      explanation
    });
  } catch (err) {
    console.error('TOP 처리 오류:', err);
    return res.status(500).json({ error: 'Failed to generate top question' });
  }
}
