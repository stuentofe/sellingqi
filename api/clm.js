// 경로: /api/clm.js

import { generateClaimQuestion } from '../../modules/clm.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { passage } = req.body;

  if (!passage || typeof passage !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing passage' });
  }

  try {
    const result = await generateClaimQuestion(passage);
    res.status(200).json(result);
  } catch (error) {
    console.error('clm API error:', error);
    res.status(500).json({ error: 'Failed to generate claim question' });
  }
}
