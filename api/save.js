export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const { problem, answer, explanation } = req.body;

  try {
    const response = await fetch('https://script.google.com/macros/s/AKfycbwDi2xBrYI30tvuR06RF_wAOTCNzyotsJpPUV6FhS8Y0h3wLGeuQlULr9lcpAClPaYVrA/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        problem,
        answer,
        explanation,
        secret: process.env.SHEET_SECRET // .env 파일에 설정
      })
    });

    const result = await response.json();
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
