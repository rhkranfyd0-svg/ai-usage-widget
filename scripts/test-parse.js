const REMAINING_WORDS = ['남음', 'left', 'remaining'];
const USED_WORDS = ['사용됨', '사용', 'used'];
const RESET_WORDS = ['초기화', '재설정', 'resets', 'reset'];

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
    for (let k = idx + 1; k < Math.min(lines.length, idx + 8); k++) {
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

const ANCHORS = {
  claude: [
    { match: ['현재 세션', 'Current session'], label: '5h' },
    { match: ['주간 한도', 'Weekly limit'], label: 'Weekly' },
  ],
  chatgpt: [{ match: ['주간 사용량 한도', 'Weekly usage limit'], label: 'Weekly' }],
  gemini: [
    { match: ['현재 사용량', 'Current usage'], label: 'Current' },
    { match: ['주간 한도', 'Weekly limit'], label: 'Weekly' },
  ],
};

const CASES = [
  {
    name: 'claude-ko',
    service: 'claude',
    text: `플랜 사용량 한도
Pro
현재 세션
3시간 37분 후 재설정
51% 사용됨
주간 한도
사용량 한도에 대해 자세히 알아보기
모든 모델
8시간 57분 후 재설정
75% 사용됨`,
    expect: [
      { label: '5h', usedPercent: 51 },
      { label: 'Weekly', usedPercent: 75 },
    ],
  },
  {
    name: 'claude-en',
    service: 'claude',
    text: `Plan usage limits
Pro
Current session
Resets in 3 hr 37 min
51% used
Weekly limit
All models
Resets in 8 hr 57 min
75% used`,
    expect: [
      { label: '5h', usedPercent: 51 },
      { label: 'Weekly', usedPercent: 75 },
    ],
  },
  {
    name: 'chatgpt-ko',
    service: 'chatgpt',
    text: `주간 사용량 한도
0% 남음
2026. 8. 20. 오후 12:50 초기화`,
    expect: [{ label: 'Weekly', usedPercent: 100 }],
  },
  {
    name: 'chatgpt-en',
    service: 'chatgpt',
    text: `Weekly usage limit
35% left
Resets Aug 20, 2026, 12:50 PM`,
    expect: [{ label: 'Weekly', usedPercent: 65 }],
  },
  {
    name: 'gemini-ko',
    service: 'gemini',
    text: `사용량 한도
PRO
현재 사용량
0% 사용됨
오후 6:08에 초기화
주간 한도
8월 25일 오후 4:08에 초기화
1% 사용됨`,
    expect: [
      { label: 'Current', usedPercent: 0 },
      { label: 'Weekly', usedPercent: 1 },
    ],
  },
  {
    name: 'gemini-en',
    service: 'gemini',
    text: `Usage limits
PRO
Current usage
0% used
Resets at 6:08 PM
Weekly limit
Resets Aug 25, 4:08 PM
1% used`,
    expect: [
      { label: 'Current', usedPercent: 0 },
      { label: 'Weekly', usedPercent: 1 },
    ],
  },
];

let failed = 0;
CASES.forEach((c) => {
  const got = extractMetricsByAnchors(c.text, ANCHORS[c.service]);
  const ok =
    got.length === c.expect.length &&
    c.expect.every(
      (e, i) => got[i] && got[i].label === e.label && got[i].usedPercent === e.usedPercent
    );
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!ok) {
    console.log('   expected:', JSON.stringify(c.expect));
    console.log('   got     :', JSON.stringify(got.map((g) => ({ label: g.label, usedPercent: g.usedPercent }))));
  }
});

console.log(failed === 0 ? '\nAll cases passed.' : `\n${failed} case(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
