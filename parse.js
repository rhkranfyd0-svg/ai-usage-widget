// Usage-screen parsing, shared by the app (main.js) and the tests
// (scripts/test-parse.js) so the two can never drift apart.
//
// Each service renders its limits as a short run of lines: a heading, a
// percentage, and a reset time — in either order, in the user's UI language.
// We anchor on the heading and scan the lines just after it.

const REMAINING_WORDS = ['남음', 'left', 'remaining'];
const USED_WORDS = ['사용됨', '사용', 'used'];
const RESET_WORDS = ['초기화', '재설정', 'resets', 'reset'];

const ANCHOR_SCAN_LINES = 8;

function containsAny(line, words) {
  const lower = line.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
}

function extractMetricsByAnchors(text, anchors) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const metrics = [];
  anchors.forEach(({ match, label }) => {
    const idx = lines.findIndex((l) => match.some((m) => l.toLowerCase() === m.toLowerCase()));
    if (idx === -1) return;
    let usedPercent = null;
    let resetText = null;
    for (let k = idx + 1; k < Math.min(lines.length, idx + ANCHOR_SCAN_LINES); k++) {
      const l = lines[k];
      if (usedPercent === null) {
        const m = l.match(/(\d{1,3})\s*%/);
        if (m && (containsAny(l, REMAINING_WORDS) || containsAny(l, USED_WORDS))) {
          const num = parseInt(m[1], 10);
          usedPercent = containsAny(l, REMAINING_WORDS) ? 100 - num : num;
        }
      }
      if (resetText === null && containsAny(l, RESET_WORDS)) {
        resetText = l;
      }
      if (usedPercent !== null && resetText !== null) break;
    }
    if (usedPercent !== null) {
      metrics.push({ label, usedPercent, resetText });
    }
  });
  return metrics;
}

// Older wordings are kept alongside the current ones: a service can roll a
// redesign out gradually, and an unmatched anchor costs nothing.
const ANCHORS = {
  claude: [
    { match: ['현재 세션', 'Current session'], label: '5h' },
    { match: ['주간 한도', 'Weekly limit'], label: 'Weekly' },
  ],
  chatgpt: [
    { match: ['5시간 한도', '5-hour limit', '5 hour limit'], label: '5h' },
    // '주간 사용량 한도' was the wording before the Sep 2026 usage-screen redesign.
    { match: ['주간 한도', '주간 사용량 한도', 'Weekly limit', 'Weekly usage limit'], label: 'Weekly' },
  ],
  gemini: [
    { match: ['현재 사용량', 'Current usage'], label: 'Current' },
    { match: ['주간 한도', 'Weekly limit'], label: 'Weekly' },
  ],
};

module.exports = { extractMetricsByAnchors, ANCHORS };
