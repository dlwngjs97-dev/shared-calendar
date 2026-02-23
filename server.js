const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { members: [], events: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function broadcast() {
  const data = readData();
  io.emit('sync', { members: data.members, events: data.events });
}

// 날짜 유틸
function toStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ─── 멤버 ───
app.get('/api/members', (req, res) => res.json(readData().members));

app.post('/api/members', (req, res) => {
  const data = readData();
  const { name, color } = req.body;
  if (!name || !color) return res.status(400).json({ error: '이름과 색상을 입력하세요' });
  if (data.members.length >= 5) return res.status(400).json({ error: '최대 5명까지' });
  if (data.members.find(m => m.name === name)) return res.status(400).json({ error: '이미 등록된 이름' });
  const member = { id: Date.now().toString(), name, color };
  data.members.push(member);
  writeData(data);
  broadcast();
  res.json(member);
});

app.delete('/api/members/:id', (req, res) => {
  const data = readData();
  data.members = data.members.filter(m => m.id !== req.params.id);
  data.events = data.events.filter(e => e.memberId !== req.params.id);
  writeData(data);
  broadcast();
  res.json({ ok: true });
});

// ─── 이벤트 ───
app.get('/api/events', (req, res) => res.json(readData().events));

// 반복 날짜 생성
function generateRepeatDates(startStr, repeat, repeatEndStr) {
  const dates = [startStr];
  if (!repeat || repeat === 'none' || !repeatEndStr) return dates;

  const startD = parse(startStr);
  const endD = parse(repeatEndStr);

  for (let i = 1; i <= 365; i++) {
    const next = new Date(startD);
    if (repeat === 'daily') next.setDate(startD.getDate() + i);
    else if (repeat === 'weekly') next.setDate(startD.getDate() + i * 7);
    else if (repeat === 'biweekly') next.setDate(startD.getDate() + i * 14);
    else if (repeat === 'monthly') next.setMonth(startD.getMonth() + i);
    else if (repeat === 'yearly') next.setFullYear(startD.getFullYear() + i);
    if (next > endD) break;
    dates.push(toStr(next));
  }
  return dates;
}

// 이벤트 생성
app.post('/api/events', (req, res) => {
  const data = readData();
  const { memberId, title, date, endDate, startTime, endTime, memo, allDay, repeat, repeatEnd } = req.body;
  if (!memberId || !title || !date) return res.status(400).json({ error: '필수 항목을 입력하세요' });

  const isRepeat = repeat && repeat !== 'none';
  const groupId = isRepeat ? 'rg_' + Date.now() : null;
  const dates = isRepeat ? generateRepeatDates(date, repeat, repeatEnd) : [date];
  const created = [];

  dates.forEach((d, i) => {
    const event = {
      id: (Date.now() + i).toString(),
      memberId, title, date: d,
      endDate: endDate || '',
      allDay: !!allDay,
      startTime: allDay ? '' : (startTime || ''),
      endTime: allDay ? '' : (endTime || ''),
      memo: memo || '',
      repeat: repeat || 'none',
      repeatEnd: repeatEnd || '',
      repeatGroup: groupId,
      createdAt: new Date().toISOString()
    };
    data.events.push(event);
    created.push(event);
  });

  writeData(data);
  broadcast();
  res.json({ count: created.length });
});

// 이벤트 수정
app.put('/api/events/:id', (req, res) => {
  const data = readData();
  const { mode } = req.query; // 'this' | 'future' | 'all'
  const target = data.events.find(e => e.id === req.params.id);
  if (!target) return res.status(404).json({ error: '일정을 찾을 수 없습니다' });

  const { title, date, endDate, startTime, endTime, memo, memberId, allDay } = req.body;

  function applyUpdate(ev) {
    if (title !== undefined) ev.title = title;
    if (date !== undefined && mode === 'this') ev.date = date;
    if (endDate !== undefined) ev.endDate = endDate;
    if (allDay !== undefined) ev.allDay = !!allDay;
    if (ev.allDay) { ev.startTime = ''; ev.endTime = ''; }
    else {
      if (startTime !== undefined) ev.startTime = startTime;
      if (endTime !== undefined) ev.endTime = endTime;
    }
    if (memo !== undefined) ev.memo = memo;
    if (memberId !== undefined) ev.memberId = memberId;
  }

  if (!target.repeatGroup || mode === 'this') {
    applyUpdate(target);
  } else if (mode === 'all') {
    data.events.filter(e => e.repeatGroup === target.repeatGroup).forEach(applyUpdate);
  } else if (mode === 'future') {
    data.events
      .filter(e => e.repeatGroup === target.repeatGroup && e.date >= target.date)
      .forEach(applyUpdate);
  }

  writeData(data);
  broadcast();
  res.json({ ok: true });
});

// 이벤트 삭제
app.delete('/api/events/:id', (req, res) => {
  const data = readData();
  const { mode } = req.query; // 'this' | 'future' | 'all'
  const target = data.events.find(e => e.id === req.params.id);
  if (!target) return res.status(404).json({ error: '일정 없음' });

  if (!target.repeatGroup || mode === 'this') {
    data.events = data.events.filter(e => e.id !== req.params.id);
  } else if (mode === 'all') {
    data.events = data.events.filter(e => e.repeatGroup !== target.repeatGroup);
  } else if (mode === 'future') {
    data.events = data.events.filter(e =>
      !(e.repeatGroup === target.repeatGroup && e.date >= target.date)
    );
  }

  writeData(data);
  broadcast();
  res.json({ ok: true });
});

// Socket.IO
io.on('connection', (socket) => {
  const data = readData();
  socket.emit('sync', { members: data.members, events: data.events });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`공유 캘린더: http://localhost:${PORT}`);
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal)
        console.log(`같은 와이파이: http://${net.address}:${PORT}`);
    }
  }
});
