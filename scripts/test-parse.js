// Fixtures are real page text captured from each service. Add a case here
// whenever a service changes its usage screen and the anchors need updating.

const { extractMetricsByAnchors, ANCHORS } = require('../parse');

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
    text: `사용량
플랜 한도
Codex, Work, 워크스페이스 에이전트, Excel용 ChatGPT에서 공유됩니다.
5시간 한도
2시간 25분 후 초기화
88% 남음
주간 한도
6일 3시간 후 초기화
92% 남음
사용량 한도 재설정`,
    expect: [
      { label: '5h', usedPercent: 12 },
      { label: 'Weekly', usedPercent: 8 },
    ],
  },
  {
    name: 'chatgpt-en',
    service: 'chatgpt',
    text: `Usage
Plan limits
5-hour limit
Resets in 2 hr 25 min
88% left
Weekly limit
Resets in 6 days 3 hr
92% left`,
    expect: [
      { label: '5h', usedPercent: 12 },
      { label: 'Weekly', usedPercent: 8 },
    ],
  },
  {
    // The pre-Sep-2026 single-limit screen, still matched via fallback anchors.
    name: 'chatgpt-ko-legacy',
    service: 'chatgpt',
    text: `주간 사용량 한도
0% 남음
2026. 8. 20. 오후 12:50 초기화`,
    expect: [{ label: 'Weekly', usedPercent: 100 }],
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
