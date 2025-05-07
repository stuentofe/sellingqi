import fs from 'fs/promises';
import path from 'path';
import { callGPT } from './fetch-gpt.js'; // 서버에서 GPT 호출 전용

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

    // 요지문 존재 여부 판단
    const prompt2 = replaceTemplate(await loadPrompt('mni2.txt'), { p });
    const hasClaim = await callGPT(prompt2);
    let finalPassage = p;
    if (hasClaim === 'NO') {
      const prompt10 = replaceTemplate(await loadPrompt('mni10.txt'), { p });
      finalPassage = (await callGPT(prompt10)).trim();
    }

    // 선택지 생성
    const c = (await callGPT(replaceTemplate(await loadPrompt('mni3.txt'), { p: finalPassage }), 'gpt-4o')).trim();
    const w = (await callGPT(replaceTemplate(await loadPrompt('mni4.txt'), { p: finalPassage, c }))).trim();
    const x = (await callGPT(replaceTemplate(await loadPrompt('mni5.txt'), { p: finalPassage, c, w }))).trim();
    const y = (await callGPT(replaceTemplate(await loadPrompt('mni6.txt'), { p: finalPassage, c, w, x }))).trim();
    const z = (await callGPT(replaceTemplate(await loadPrompt('mni7.txt'), { p: finalPassage, c, w, x, y }))).trim();

    const options = [c, w, x, y, z];
    const sorted = [...options].sort((a, b) => a.length - b.length);
    const labels = ['①','②','③','④','⑤'];
    const correctIndex = sorted.findIndex(opt => opt === c);
    const optionItems = sorted.map((opt, i) => ({ label: labels[i], text: opt }));

    // 해설 생성
    const e = (await callGPT(replaceTemplate(await loadPrompt('mni8.txt'), { p: finalPassage, c }))).trim();
    const f = (await callGPT(replaceTemplate(await loadPrompt('mni9.txt'), { p: finalPassage, c }))).trim();
    const answerNum = labels[correctIndex];
    const josa = ['이','가','이','가','가'][correctIndex];
    const explanation = `${e} 글의 요지는, 문장 ${f}에서 가장 명시적으로 드러난다. 따라서, 글의 요지는 ${answerNum}${josa} 가장 적절하다.`;

    const body = `
      <p>${finalPassage}</p>
      <ul>
        ${optionItems.map(item => `<li>${item.label} ${item.text}</li>`).join('')}
      </ul>
    `;

    return res.status(200).json({
      prompt: '다음 글의 요지로 가장 적절한 것은?',
      body,
      answer: answerNum,
      explanation
    });

  } catch (err) {
    console.error('MNI 처리 오류:', err);
    return res.status(500).json({ error: 'Failed to generate mni question' });
  }
}
