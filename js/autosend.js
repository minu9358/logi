/* =============================================
   자동전송 모듈 - 완전 독립 파일
   ============================================= */

(function() {
  const HOUR   = 18;
  const MINUTE = 30;

  let enabled  = false;
  let sendTimer    = null;
  let cdInterval   = null;

  // ── DOM 준비 후 실행 ──────────────────────────
  document.addEventListener('DOMContentLoaded', function() {

    // 버튼 찾기
    var btn = document.getElementById('autoSendBtn');
    if (!btn) { console.error('[AutoSend] 버튼 없음'); return; }

    // 클릭 이벤트
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      toggle();
    });

    // 저장된 설정 복원
    enabled = localStorage.getItem('auto_send_enabled') === 'true';
    render();
    if (enabled) schedule();
  });

  // ── ON/OFF 전환 ───────────────────────────────
  function toggle() {
    enabled = !enabled;
    localStorage.setItem('auto_send_enabled', String(enabled));
    render();

    if (enabled) {
      schedule();
      toast('⏰ 자동전송 ON  - 매일 18:30 전송', 'success');
    } else {
      if (sendTimer)  { clearTimeout(sendTimer);   sendTimer  = null; }
      if (cdInterval) { clearInterval(cdInterval); cdInterval = null; }
      var cd = document.getElementById('autoSendCountdown');
      if (cd) cd.textContent = '';
      toast('⏰ 자동전송 OFF', 'info');
    }
  }

  // ── 버튼 UI 갱신 ─────────────────────────────
  function render() {
    var btn   = document.getElementById('autoSendBtn');
    var label = document.getElementById('autoSendLabel');
    if (!btn || !label) return;

    if (enabled) {
      btn.className     = 'btn btn-auto-on';
      label.textContent = '자동전송 ON';
      startCountdown();
    } else {
      btn.className     = 'btn btn-auto-off';
      label.textContent = '자동전송 OFF';
    }
  }

  // ── 카운트다운 ───────────────────────────────
  function startCountdown() {
    if (cdInterval) clearInterval(cdInterval);
    var cd = document.getElementById('autoSendCountdown');
    if (!cd) return;

    function tick() {
      if (!enabled) { cd.textContent = ''; return; }
      var now  = new Date();
      var next = new Date();
      next.setHours(HOUR, MINUTE, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      var diff = next - now;
      var h = Math.floor(diff / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      cd.textContent =
        pad(h) + ':' + pad(m) + ':' + pad(s) + ' 후 자동전송';
    }

    tick();
    cdInterval = setInterval(tick, 1000);
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  // ── 타이머 예약 ──────────────────────────────
  function schedule() {
    if (sendTimer) clearTimeout(sendTimer);
    var now  = new Date();
    var next = new Date();
    next.setHours(HOUR, MINUTE, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    var ms = next - now;

    sendTimer = setTimeout(function() {
      send();
      // 다음날 재예약
      sendTimer = null;
      schedule();
    }, ms);
  }

  // ── 실제 전송 ────────────────────────────────
  async function send() {
    var token  = '8665540067:AAFmSiDZ9Ygnf3-ZsFU4E1oxxSqkqe8XOLQ';
    var chatId = '-5070526255';
    if (!token || !chatId) {
      toast('❌ 텔레그램 설정 없음 - 자동전송 실패', 'error');
      return;
    }

    // 오늘 날짜 보고서 최신화
    var today = new Date().toISOString().slice(0, 10);
    var dateEl = document.getElementById('reportDate');
    if (dateEl) dateEl.value = today;

    // loadReport 있으면 실행
    if (typeof loadReport === 'function') {
      await loadReport();
      await new Promise(function(r) { setTimeout(r, 1000); });
    }

    // 메시지 빌드
    var text = (typeof buildTelegramMessage === 'function')
      ? buildTelegramMessage()
      : '보고서 자동전송';

    try {
      var res  = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text })
      });
      var json = await res.json();
      if (json.ok) {
        toast('✅ 18:30 자동전송 완료!', 'success');
      } else {
        toast('❌ 자동전송 실패: ' + (json.description || '오류'), 'error');
      }
    } catch(e) {
      toast('❌ 자동전송 네트워크 오류', 'error');
    }
  }

  // ── 토스트 ───────────────────────────────────
  function toast(msg, type) {
    if (typeof showToast === 'function') {
      showToast(msg, type);
    } else {
      alert(msg);
    }
  }

})();
