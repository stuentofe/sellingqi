<!-- freetypes.html 내부 스크립트 -->
<script type="module">
  import {
    splitParagraphIntoSentences,
    generateAllOrderQuestions
  } from './api/ordering.js';

  const textarea = document.querySelector("textarea");
  const outputDiv = document.getElementById("output");
  const orderBtn = document.querySelectorAll("button")[1]; // 순서 배열 문제 생성 버튼

  orderBtn.addEventListener("click", () => {
    const raw = textarea.value.trim();
    const sentences = splitParagraphIntoSentences(raw);
    const questions = generateAllOrderQuestions(sentences);

    outputDiv.innerHTML = "";
    questions.forEach((q, i) => {
      const pre = document.createElement("pre");
      pre.textContent = `${i + 1}\n\n${q}.`;
      outputDiv.appendChild(pre);
    });
  });
</script>
