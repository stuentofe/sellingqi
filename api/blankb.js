// Vercel 배포용 API Route: 어구 교체형 문제 생성
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const inlinePrompts = {
  // 🆕 STEP 1: 요약
  step1_summary: `
Summarize the following within 30 words limit:
{{p}}
Do not respond in conversational form. Do not include labels, headings, or explanations.
Only output the summary.
  `,

  // 🆕 STEP 2: 요약에서 key concepts 추출
  step2_concepts: `
The following is a summary of a passage. 
Extract key concepts from this summary that help grasp the meaning of the original passage.
Each concept should be a noun phrase or a verb phrase (2–7 words).
Do not add any explanations, labels, or formatting. Write each concept on a new line.

Summary:
{{summary}}

Original passage for reference:
{{p}}
  `,

  // 🆕 STEP 3: 지문에서 key concept에 해당하는 어구 선택 (verbatim)
  step3_c1_selection: `
The following is a list of key concepts extracted from the summary of the passage.

If any of these key concepts (in the form of noun or verb phrases, 2–7 words) appear in the original passage, select one that is most relevant and copy it exactly as it appears in the original passage. If the key concepts correspond to a whole sentence, then only select a part of it, preferrably a noun phrase or a verb phrase in the sentence.

Preserve original casing and punctuation.  
Do not output anything other than the exact phrase.

Key concepts:
{{concepts}}

Passage:
{{p}}
  `,

  // 기존 유지: paraphrase 생성
  secondPrompt: `
Do not say in conversational form. Only output the result.
I’d like to paraphrase ‘{{c1}}’ in the following passage with a new phrase of similar length. Recommend one.
Do not use punctuation.
Passage: {{p}}
  `,

  thirdPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a different meaning from '{{c1}}' or '{{c2}}'. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Do not use punctuation. Write only the part for the blank.
Sentence: {{b}}
  `,

  fourthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a different meaning from '{{c1}}', '{{c2}}' or '{{w1}}'. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Do not use punctuation. Write only the part for the blank.
Sentence: {{b}}
  `,

  fifthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a different meaning from '{{c1}}, '{{c2}}', '{{w2}}, or '{{w1}}'. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Do not use punctuation. Write only the part for the blank.
Sentence: {{b}}
  `,

  sixthPrompt: `
Do not say in conversational form. Only output the result.
Suggest a phrase that can be put in the blank of the following sentence, but that when put in it, creates a different meaning from '{{c1}}, '{{c2}}', '{{w2}}, '{{w3}}', or '{{w1}}'. Make sure your suggestion is also similar in its length to {{c2}}, but looks different on a superficial level.
Do not use punctuation. Write only the part for the blank.
Sentence: {{b}}
  `,

  explanationPrompt: `
Do not say in conversational form. Only output the result.
다음 지문의 빈칸에 정답 어구가 들어가야 하는 이유를 한국어로 설명하는 해설을 작성하라. 문체는 "~(이)다"체를 사용해야 한다. 지문을 직접 인용해서는 안된다. 100자 이내로 다음 형식을 참고하여 써라: ~라는 글이다. (필요할 경우 추가 근거) 따라서, 빈칸에 들어갈 말로 가장 적절한 것은 ~이다.

지문: {{p}}
정답: {{c2}}
  `,

  verifyWrongWord: `
Evaluate whether the following phrase fits naturally in the blank of the given passage.

Passage with blank:
{{p}}

Phrase: {{w}}

If the phrase fits naturally and makes the sentence contextually appropriate, output a different phrase of similar length that sounds inappropriate in this context. 
If the phrase does NOT fit naturally, just output "no".

Only output the phrase or "no" with no punctuation or explanation.
  `
};

