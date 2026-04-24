/* =============================================
   팀원 목록 공유 모듈 – members.js
   모든 페이지(index, duty, share)에서 공통 사용
   ============================================= */

const MEMBERS_KEY     = 'logistics_members_v1';
const DEFAULT_MEMBERS = ['김민우', '석미경', '고성진', '장휘인', '김도훈', '김구현'];

/** 저장된 팀원 목록 반환 (없으면 기본값) */
function getMembers() {
  try {
    const s = localStorage.getItem(MEMBERS_KEY);
    if (s) {
      const arr = JSON.parse(s);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch (e) {}
  return [...DEFAULT_MEMBERS];
}

/** 팀원 목록 저장 */
function saveMembers(arr) {
  localStorage.setItem(MEMBERS_KEY, JSON.stringify(arr));
  // 변경 이벤트 발행 → 같은 탭 내 다른 모듈이 수신 가능
  window.dispatchEvent(new CustomEvent('membersChanged', { detail: arr }));
}
