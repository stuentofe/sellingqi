import {
  splitParagraphIntoSentences,
  generateAllOrderQuestions
} from '../lib/ordering.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'No input text' });
  }

  const sentences = splitParagraphIntoSentences(text);
  const questions = generateAllOrderQuestions(sentences);

  res.status(200).json({ questions });
}
