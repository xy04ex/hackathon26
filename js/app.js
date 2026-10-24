// app.js — UI wiring + localStorage history.
// Built up across tasks 2–5. For now, just confirm the page is wired.
document.addEventListener("DOMContentLoaded", () => {
  const scoreSection = document.getElementById("score-section");
  if (scoreSection) {
    scoreSection.innerHTML =
      '<p class="muted">Skeleton ready. Recovery score arrives in the next step.</p>';
  }
});
