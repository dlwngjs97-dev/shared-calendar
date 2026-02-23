// ─── 상태 ───
let members = [];
let events = [];
let currentDate = new Date();
let hiddenMembers = new Set();
let socket;
let pendingRepeatAction = null;

const SHARED = { id: '__shared', name: '공용', color: '#555555' };

// ─── DOM ───
const $ = id => document.getElementById(id);
const calendarDays = $('calendar-days');
const currentMonthEl = $('current-month');
const memberChips = $('member-chips');
const todayEventsEl = $('today-events');
const todayTitle = $('today-title');
const connStatus = $('conn-status');

// ─── 소켓 ───
function initSocket() {
  socket = io();
  socket.on('connect', () => {
    connStatus.textContent = '실시간 연결됨';
    connStatus.className = 'conn-status online';
  });
  socket.on('disconnect', () => {
    connStatus.textContent = '연결 끊김 — 재연결 중...';
    connStatus.className = 'conn-status offline';
  });
  socket.on('sync', data => {
    members = data.members;
    events = data.events;
    renderAll();
  });
}

// ─── API ───
async function api(url, method = 'GET', body = null) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  return (await fetch(url, opt)).json();
}

function allMembers() { return [SHARED, ...members]; }
function findMember(id) { return id === '__shared' ? SHARED : members.find(x => x.id === id); }

// ─── 렌더 ───
function renderAll() {
  renderCalendar();
  renderMembers();
  renderTodayEvents();
}

// ─── 캘린더 ───
// 특정 날짜에 해당하는 이벤트 (시작일~종료일 범위 포함)
function eventsFor(ds) {
  return events.filter(e => {
    if (e.endDate && e.endDate >= e.date) {
      return ds >= e.date && ds <= e.endDate;
    }
    return e.date === ds;
  }).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
}

function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  currentMonthEl.textContent = `${year}년 ${month + 1}월`;

  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - first.getDay());

  const todayStr = fmtDate(new Date());
  let html = '';
  const cur = new Date(start);

  for (let i = 0; i < 42; i++) {
    const ds = fmtDate(cur);
    const other = cur.getMonth() !== month;
    const isToday = ds === todayStr;
    const dayEv = eventsFor(ds);

    let cls = 'day-cell';
    if (other) cls += ' other';
    if (isToday) cls += ' today';

    html += `<div class="${cls}" data-date="${ds}">`;
    html += `<div class="day-num">${cur.getDate()}</div>`;
    html += '<div class="day-dots">';

    const max = 2;
    dayEv.slice(0, max).forEach(ev => {
      const m = findMember(ev.memberId);
      const c = m ? m.color : '#868e96';
      const dim = hiddenMembers.has(ev.memberId) ? ' dimmed' : '';
      html += `<span class="day-tag${dim}" style="background:${c}">${ev.title}</span>`;
    });
    if (dayEv.length > max) html += `<span class="day-more">+${dayEv.length - max}</span>`;

    html += '</div></div>';
    cur.setDate(cur.getDate() + 1);
  }

  calendarDays.innerHTML = html;
  calendarDays.querySelectorAll('.day-cell').forEach(cell => {
    cell.addEventListener('click', () => openDaySheet(cell.dataset.date));
  });
}

// ─── 멤버 칩 ───
function renderMembers() {
  const all = allMembers();
  memberChips.innerHTML = all.map(m => {
    const dim = hiddenMembers.has(m.id) ? ' dimmed' : '';
    return `<button class="chip active${dim}" style="background:${m.color}" data-mid="${m.id}">${m.name}</button>`;
  }).join('');

  memberChips.querySelectorAll('.chip').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.mid;
      hiddenMembers.has(id) ? hiddenMembers.delete(id) : hiddenMembers.add(id);
      renderAll();
    });
    let timer;
    el.addEventListener('touchstart', () => {
      if (el.dataset.mid === '__shared') return;
      timer = setTimeout(() => {
        const m = findMember(el.dataset.mid);
        if (confirm(`${m.name} 삭제? (일정도 모두 삭제)`)) api(`/api/members/${m.id}`, 'DELETE');
      }, 800);
    });
    el.addEventListener('touchend', () => clearTimeout(timer));
    el.addEventListener('touchmove', () => clearTimeout(timer));
  });
}

// ─── 오늘 일정 ───
function renderTodayEvents() {
  const d = new Date();
  const todayStr = fmtDate(d);
  todayTitle.textContent = `${d.getMonth()+1}월 ${d.getDate()}일 오늘`;

  const ev = eventsFor(todayStr).filter(e => !hiddenMembers.has(e.memberId));
  if (!ev.length) {
    todayEventsEl.innerHTML = '<div class="today-empty">오늘 등록된 일정이 없습니다</div>';
    return;
  }

  todayEventsEl.innerHTML = ev.map(e => {
    const m = findMember(e.memberId);
    const c = m ? m.color : '#868e96';
    const time = formatTimeDisplay(e);
    const dateRange = formatDateRange(e);
    return `<div class="today-card">
      <span class="tc-dot" style="background:${c}"></span>
      <div class="tc-info">
        <div class="tc-name">${m ? m.name : '?'}</div>
        <div class="tc-title">${e.title}${e.memo ? ' · '+e.memo : ''}</div>
        ${dateRange ? `<div class="tc-time">${dateRange}</div>` : ''}
        ${time ? `<div class="tc-time">${time}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ─── 유틸 ───
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDateKR(ds) {
  const d = new Date(ds.replace(/-/g, '/'));
  const w = ['일','월','화','수','목','금','토'];
  return `${d.getMonth()+1}월 ${d.getDate()}일 (${w[d.getDay()]})`;
}

function fmtDateShort(ds) {
  const d = new Date(ds.replace(/-/g, '/'));
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function formatTimeDisplay(ev) {
  if (ev.allDay) return '';
  if (ev.startTime) return `${ev.startTime}${ev.endTime ? ' ~ '+ev.endTime : ''}`;
  return '';
}

function formatDateRange(ev) {
  if (ev.endDate && ev.endDate !== ev.date) {
    return `${fmtDateShort(ev.date)} ~ ${fmtDateShort(ev.endDate)}`;
  }
  if (ev.allDay) return '종일';
  return '';
}

function repeatLabel(r) {
  const map = { daily:'매일', weekly:'매주', biweekly:'격주', monthly:'매월', yearly:'매년' };
  return map[r] || '';
}

// ─── 시트 ───
function openSheet(id) { $(id).classList.add('active'); }
function closeSheet(id) { $(id).classList.remove('active'); }

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeSheet(btn.dataset.close));
});
document.querySelectorAll('.sheet-overlay').forEach(ov => {
  ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('active'); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.sheet-overlay.active').forEach(m => m.classList.remove('active'));
});

// ─── 네비게이션 ───
$('btn-prev').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth()-1); renderCalendar(); });
$('btn-next').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth()+1); renderCalendar(); });
$('btn-today').addEventListener('click', () => { currentDate = new Date(); renderCalendar(); });

let touchStartX = 0;
const calEl = document.querySelector('.calendar');
calEl.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
calEl.addEventListener('touchend', e => {
  const diff = touchStartX - e.changedTouches[0].screenX;
  if (Math.abs(diff) > 60) {
    currentDate.setMonth(currentDate.getMonth() + (diff > 0 ? 1 : -1));
    renderCalendar();
  }
});

// ─── 멤버 추가 ───
$('btn-add-member').addEventListener('click', () => {
  $('member-name').value = '';
  openSheet('sheet-member');
  setTimeout(() => $('member-name').focus(), 300);
});

$('form-member').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('member-name').value.trim();
  const color = document.querySelector('input[name="mc"]:checked').value;
  if (!name) return;
  const res = await api('/api/members', 'POST', { name, color });
  if (res.error) { alert(res.error); return; }
  closeSheet('sheet-member');
});

// ─── 일정 폼 ───
const allDayToggle = $('event-allday');
const timeFields = $('time-fields');
const customTitleInput = $('event-custom-title');
const repeatUntil = $('repeat-until');

allDayToggle.addEventListener('change', () => {
  timeFields.style.display = allDayToggle.checked ? 'none' : 'flex';
});

document.querySelectorAll('input[name="evt-title"]').forEach(opt => {
  opt.addEventListener('change', () => {
    customTitleInput.style.display = opt.value === '__custom' ? 'block' : 'none';
    if (opt.value === '__custom') setTimeout(() => customTitleInput.focus(), 100);
  });
});

document.querySelectorAll('input[name="evt-repeat"]').forEach(opt => {
  opt.addEventListener('change', () => {
    const show = opt.value !== 'none';
    repeatUntil.style.display = show ? 'block' : 'none';
    if (show && !$('event-repeat-end').value) {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      $('event-repeat-end').value = fmtDate(d);
    }
  });
});

// 시작일 변경 시 종료일 자동 조정
$('event-date').addEventListener('change', () => {
  const startVal = $('event-date').value;
  const endVal = $('event-end-date').value;
  if (endVal && endVal < startVal) {
    $('event-end-date').value = startVal;
  }
});

// FAB
$('btn-fab').addEventListener('click', () => openEventSheet());

function openEventSheet(date = null, evData = null) {
  const form = $('form-event');
  const title = $('sheet-event-title');
  const delBtn = $('btn-delete-event');
  const repeatField = $('repeat-field');

  form.reset();
  $('event-id').value = '';
  customTitleInput.style.display = 'none';
  allDayToggle.checked = true;
  timeFields.style.display = 'none';
  repeatUntil.style.display = 'none';

  // 멤버 버튼
  const row = $('member-select-row');
  const all = allMembers();
  row.innerHTML = all.map((m, i) => `
    <button type="button" class="member-sel-btn${i===0?' selected':''}" data-mid="${m.id}" style="color:${m.color}">
      <span class="ms-dot" style="background:${m.color}"></span>${m.name}
    </button>
  `).join('');

  row.querySelectorAll('.member-sel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      row.querySelectorAll('.member-sel-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  if (evData) {
    title.textContent = '일정 수정';
    delBtn.style.display = 'block';
    repeatField.style.display = 'none';
    $('event-id').value = evData.id;

    row.querySelectorAll('.member-sel-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.mid === evData.memberId);
    });

    const presets = ['휴무','늦퇴','회의','회의불참','여행'];
    if (presets.includes(evData.title)) {
      const r = document.querySelector(`input[name="evt-title"][value="${evData.title}"]`);
      if (r) r.checked = true;
    } else {
      const r = document.querySelector('input[name="evt-title"][value="__custom"]');
      if (r) r.checked = true;
      customTitleInput.style.display = 'block';
      customTitleInput.value = evData.title;
    }

    $('event-date').value = evData.date;
    $('event-end-date').value = evData.endDate || '';
    allDayToggle.checked = !!evData.allDay;
    timeFields.style.display = evData.allDay ? 'none' : 'flex';
    $('event-start').value = evData.startTime || '';
    $('event-end').value = evData.endTime || '';
    $('event-memo').value = evData.memo || '';
  } else {
    title.textContent = '일정 추가';
    delBtn.style.display = 'none';
    repeatField.style.display = 'block';
    $('event-date').value = date || fmtDate(new Date());
    $('event-end-date').value = '';
    const ft = document.querySelector('input[name="evt-title"]');
    if (ft) ft.checked = true;
    const nr = document.querySelector('input[name="evt-repeat"][value="none"]');
    if (nr) nr.checked = true;
  }

  openSheet('sheet-event');
}

function getFormData() {
  const selectedMember = document.querySelector('.member-sel-btn.selected');
  if (!selectedMember) { alert('멤버를 선택하세요'); return null; }

  const titleRadio = document.querySelector('input[name="evt-title"]:checked');
  if (!titleRadio) { alert('일정을 선택하세요'); return null; }

  let titleVal = titleRadio.value;
  if (titleVal === '__custom') {
    titleVal = customTitleInput.value.trim();
    if (!titleVal) { alert('일정 제목을 입력하세요'); return null; }
  }

  const repeatRadio = document.querySelector('input[name="evt-repeat"]:checked');
  const repeat = repeatRadio ? repeatRadio.value : 'none';
  const repeatEnd = $('event-repeat-end').value;
  if (repeat !== 'none' && !repeatEnd) { alert('반복 종료일을 선택하세요'); return null; }

  const date = $('event-date').value;
  if (!date) { alert('날짜를 선택하세요'); return null; }

  const endDate = $('event-end-date').value;
  if (endDate && endDate < date) { alert('종료일은 시작일 이후여야 합니다'); return null; }

  return {
    memberId: selectedMember.dataset.mid,
    title: titleVal,
    date,
    endDate: endDate || '',
    allDay: allDayToggle.checked,
    startTime: allDayToggle.checked ? '' : $('event-start').value,
    endTime: allDayToggle.checked ? '' : $('event-end').value,
    memo: $('event-memo').value.trim(),
    repeat,
    repeatEnd
  };
}

// 폼 제출
$('form-event').addEventListener('submit', async e => {
  e.preventDefault();
  const data = getFormData();
  if (!data) return;

  const eventId = $('event-id').value;

  if (eventId) {
    const ev = events.find(e => e.id === eventId);
    if (ev && ev.repeatGroup) {
      pendingRepeatAction = { type: 'edit', eventId, formData: data };
      $('repeat-action-title').textContent = '반복 일정 수정';
      closeSheet('sheet-event');
      openSheet('sheet-repeat-action');
      return;
    }
    await api(`/api/events/${eventId}?mode=this`, 'PUT', data);
  } else {
    await api('/api/events', 'POST', data);
  }

  closeSheet('sheet-event');
});

// 삭제
$('btn-delete-event').addEventListener('click', () => {
  const eventId = $('event-id').value;
  if (!eventId) return;

  const ev = events.find(e => e.id === eventId);
  if (ev && ev.repeatGroup) {
    pendingRepeatAction = { type: 'delete', eventId };
    $('repeat-action-title').textContent = '반복 일정 삭제';
    closeSheet('sheet-event');
    openSheet('sheet-repeat-action');
  } else {
    if (!confirm('이 일정을 삭제할까요?')) return;
    api(`/api/events/${eventId}?mode=this`, 'DELETE');
    closeSheet('sheet-event');
  }
});

// 반복 액션
document.querySelectorAll('[data-repeat-mode]').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!pendingRepeatAction) return;
    const mode = btn.dataset.repeatMode;
    const { type, eventId, formData } = pendingRepeatAction;

    if (type === 'delete') {
      await api(`/api/events/${eventId}?mode=${mode}`, 'DELETE');
    } else if (type === 'edit') {
      await api(`/api/events/${eventId}?mode=${mode}`, 'PUT', formData);
    }

    pendingRepeatAction = null;
    closeSheet('sheet-repeat-action');
  });
});

// ─── 날짜 상세 ───
function openDaySheet(dateStr) {
  $('sheet-day-title').textContent = fmtDateKR(dateStr);

  const list = $('day-events-list');
  const dayEv = eventsFor(dateStr).filter(e => !hiddenMembers.has(e.memberId));

  if (!dayEv.length) {
    list.innerHTML = '<div class="day-empty">등록된 일정이 없습니다</div>';
  } else {
    list.innerHTML = dayEv.map(ev => {
      const m = findMember(ev.memberId);
      const c = m ? m.color : '#868e96';
      const name = m ? m.name : '?';
      const time = formatTimeDisplay(ev);
      const dateRange = formatDateRange(ev);
      const rpt = ev.repeat && ev.repeat !== 'none' ? repeatLabel(ev.repeat) + ' 반복' : '';
      const metaParts = [dateRange, time, ev.memo].filter(Boolean).join(' · ');
      return `<div class="day-ev" data-eid="${ev.id}">
        <span class="de-dot" style="background:${c}"></span>
        <div class="de-info">
          <div class="de-title">${name} · ${ev.title}</div>
          ${metaParts ? `<div class="de-meta">${metaParts}</div>` : ''}
          ${rpt ? `<div class="de-repeat">${rpt}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.day-ev').forEach(el => {
      el.addEventListener('click', () => {
        closeSheet('sheet-day');
        const ev = events.find(e => e.id === el.dataset.eid);
        if (ev) openEventSheet(null, ev);
      });
    });
  }

  $('btn-add-event-day').onclick = () => {
    closeSheet('sheet-day');
    openEventSheet(dateStr);
  };

  openSheet('sheet-day');
}

// ─── 시작 ───
initSocket();
