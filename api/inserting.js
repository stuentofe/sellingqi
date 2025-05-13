// api/inserting.js

import { generateAllInsertionProblems } from '../lib/inserting.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing text' });
  }

  const problems = generateAllInsertionProblems(text);

  // 에러 메시지가 포함된 결과일 경우 그대로 전달
  if (problems.length === 1 && problems[0].error) {
    return res.status(400).json({ error: problems[0].error });
  }

  res.status(200).json({ problems });
}
