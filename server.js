const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://dlwngjs97:Centras123%21@cluster0.7ugphzq.mongodb.net/shared-calendar?retryWrites=true&w=majority';

let db;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB 연결
async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('shared-calendar');
  console.log('MongoDB 연결 완료');
}

// DB 읽기/쓰기 헬퍼
async function getMembers() {
  return db.collection('members').find().toArray();
}

async function getEvents() {
  return db.collection('events').find().toArray();
}

async function broadcast() {
  const [members, events] = await Promise.all([getMembers(), getEvents()]);
  io.emit('sync', { members, events });
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
app.get('/api/members', async (req, res) => {
  res.json(await getMembers());
});

app.post('/api/members', async (req, res) => {
  const { name, color } = req.body;
  if (!name || !color) return res.status(400).json({ error: '이름과 색상을 입력하세요' });

  const members = await getMembers();
  if (members.length >= 5) return res.status(400).json({ error: '최대 5명까지' });
  if (members.find(m => m.name === name)) return res.status(400).json({ error: '이미 등록된 이름' });

  const member = { id: Date.now().toString(), name, color };
  await db.collection('members').insertOne(member);
  await broadcast();
  res.json(member);
});

app.delete('/api/members/:id', async (req, res) => {
  await db.collection('members').deleteOne({ id: req.params.id });
  await db.collection('events').deleteMany({ memberId: req.params.id });
  await broadcast();
  res.json({ ok: true });
});

// ─── 이벤트 ───
app.get('/api/events', async (req, res) => {
  res.json(await getEvents());
});

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

app.post('/api/events', async (req, res) => {
  const { memberId, title, date, endDate, startTime, endTime, memo, allDay, repeat, repeatEnd } = req.body;
  if (!memberId || !title || !date) return res.status(400).json({ error: '필수 항목을 입력하세요' });

  const isRepeat = repeat && repeat !== 'none';
  const groupId = isRepeat ? 'rg_' + Date.now() : null;
  const dates = isRepeat ? generateRepeatDates(date, repeat, repeatEnd) : [date];
  const docs = [];

  dates.forEach((d, i) => {
    docs.push({
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
    });
  });

  await db.collection('events').insertMany(docs);
  await broadcast();
  res.json({ count: docs.length });
});

app.put('/api/events/:id', async (req, res) => {
  const { mode } = req.query;
  const target = await db.collection('events').findOne({ id: req.params.id });
  if (!target) return res.status(404).json({ error: '일정을 찾을 수 없습니다' });

  const { title, date, endDate, startTime, endTime, memo, memberId, allDay } = req.body;
  const update = {};
  if (title !== undefined) update.title = title;
  if (date !== undefined && mode === 'this') update.date = date;
  if (endDate !== undefined) update.endDate = endDate;
  if (allDay !== undefined) {
    update.allDay = !!allDay;
    if (allDay) { update.startTime = ''; update.endTime = ''; }
    else {
      if (startTime !== undefined) update.startTime = startTime;
      if (endTime !== undefined) update.endTime = endTime;
    }
  } else {
    if (startTime !== undefined) update.startTime = startTime;
    if (endTime !== undefined) update.endTime = endTime;
  }
  if (memo !== undefined) update.memo = memo;
  if (memberId !== undefined) update.memberId = memberId;

  if (!target.repeatGroup || mode === 'this') {
    await db.collection('events').updateOne({ id: req.params.id }, { $set: update });
  } else if (mode === 'all') {
    await db.collection('events').updateMany({ repeatGroup: target.repeatGroup }, { $set: update });
  } else if (mode === 'future') {
    await db.collection('events').updateMany(
      { repeatGroup: target.repeatGroup, date: { $gte: target.date } },
      { $set: update }
    );
  }

  await broadcast();
  res.json({ ok: true });
});

app.delete('/api/events/:id', async (req, res) => {
  const { mode } = req.query;
  const target = await db.collection('events').findOne({ id: req.params.id });
  if (!target) return res.status(404).json({ error: '일정 없음' });

  if (!target.repeatGroup || mode === 'this') {
    await db.collection('events').deleteOne({ id: req.params.id });
  } else if (mode === 'all') {
    await db.collection('events').deleteMany({ repeatGroup: target.repeatGroup });
  } else if (mode === 'future') {
    await db.collection('events').deleteMany(
      { repeatGroup: target.repeatGroup, date: { $gte: target.date } }
    );
  }

  await broadcast();
  res.json({ ok: true });
});

// Socket.IO
io.on('connection', async (socket) => {
  const [members, events] = await Promise.all([getMembers(), getEvents()]);
  socket.emit('sync', { members, events });
});

// 서버 시작
connectDB().then(() => {
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
}).catch(err => {
  console.error('MongoDB 연결 실패:', err.message);
  process.exit(1);
});
