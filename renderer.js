const COLORS = {
  claude: '#d97757',
  chatgpt: '#10a37f',
  gemini: '#4285f4',
};

const rowsEl = document.getElementById('rows');
const pinBtn = document.getElementById('pin');
const refreshBtn = document.getElementById('refresh');
const closeBtn = document.getElementById('closeBtn');
const opacitySlider = document.getElementById('opacity');

const rowEls = {};

function buildRows(services) {
  rowsEl.innerHTML = '';
  services.forEach((svc) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="dot" style="background:${COLORS[svc.id] || '#555'}"></div>
      <div class="info">
        <div class="name-line">
          <span class="name">${svc.label}</span>
          <span class="status-text">확인 중...</span>
        </div>
        <div class="metrics"></div>
      </div>
      <div class="link-btn" title="웹에서 열기">&#8599;</div>
    `;
    row.querySelector('.link-btn').addEventListener('click', () => window.widget.openExternal(svc.id));
    rowsEl.appendChild(row);
    rowEls[svc.id] = {
      status: row.querySelector('.status-text'),
      metrics: row.querySelector('.metrics'),
      color: COLORS[svc.id] || '#6c63ff',
    };
  });
}

const LABEL_TEXT = {
  '5h': '5시간 한도',
  Weekly: '주간 한도',
  Current: '현재 사용량',
};

function metricHtml(m, color) {
  const pct = Math.max(0, Math.min(100, m.usedPercent));
  const label = LABEL_TEXT[m.label] || m.label || '사용량';
  return `
    <div class="metric">
      <div class="metric-top">
        <span class="metric-label" title="${label}">${label}</span>
        <span class="metric-percent">${pct}%</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="background:${color};width:${pct}%"></div></div>
      ${m.resetText ? `<div class="reset" title="${m.resetText}">${m.resetText}</div>` : ''}
    </div>
  `;
}

function renderUsage(id, data) {
  const els = rowEls[id];
  if (!els) return;

  if (data && data.needsLogin) {
    els.status.textContent = '로그인 필요';
    els.metrics.innerHTML = '<div class="login-btn">로그인하기</div>';
    els.metrics.querySelector('.login-btn').addEventListener('click', () =>
      window.widget.startLogin(id)
    );
    return;
  }

  if (!data || !data.ok || !data.metrics || data.metrics.length === 0) {
    els.status.textContent = data && data.ok === false ? '오류' : '--';
    els.metrics.innerHTML = `<div class="reset">${
      data && data.error ? '확인 실패 (다음 주기에 재시도)' : '사용량 정보 없음'
    }</div>`;
    return;
  }

  els.status.textContent = new Date(data.updatedAt).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  els.metrics.innerHTML = data.metrics.map((m) => metricHtml(m, els.color)).join('');
}

function setPin(v) {
  pinBtn.classList.toggle('active', v);
}

refreshBtn.addEventListener('click', () => window.widget.refreshAll());
pinBtn.addEventListener('click', () => window.widget.togglePin());
closeBtn.addEventListener('click', () => window.widget.hideWindow());
opacitySlider.addEventListener('input', () => {
  const alpha = Number(opacitySlider.value) / 100;
  document.documentElement.style.setProperty('--bg-alpha', alpha);
  window.widget.setBgAlpha(alpha);
});

window.widget.getInitState().then((state) => {
  buildRows(state.services);
  setPin(state.alwaysOnTop);
  const alpha = typeof state.bgAlpha === 'number' ? state.bgAlpha : 0.92;
  opacitySlider.value = Math.round(alpha * 100);
  document.documentElement.style.setProperty('--bg-alpha', alpha);
  state.services.forEach((svc) => renderUsage(svc.id, state.usage[svc.id]));
});

window.widget.onUsageUpdate(({ id, data }) => renderUsage(id, data));
window.widget.onPinState(setPin);

const loginBarText = document.getElementById('loginBarText');
document.getElementById('loginDone').addEventListener('click', () => window.widget.endLogin());
window.widget.onLoginMode((payload) => {
  if (payload) {
    loginBarText.textContent = `${payload.label} 로그인 후 [완료]를 누르세요`;
    document.body.classList.add('login-mode');
  } else {
    document.body.classList.remove('login-mode');
  }
});
