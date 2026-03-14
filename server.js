require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { initDB } = require('./db/schema');

const app = express();
const PORT = process.env.PORT || 3000;
const db = initDB();

// Notification helper
function notify(userId, type, title, message, link) {
  db.prepare('INSERT INTO notifications (id,user_id,type,title,message,link) VALUES (?,?,?,?,?,?)')
    .run(uuidv4(), userId, type, title, message, link || '');
}

app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// API
app.use('/api/auth', require('./routes/auth')(db));
app.use('/api/admin', require('./routes/admin')(db, notify));
app.use('/api/approver', require('./routes/approver')(db, notify));
app.use('/api/submissions', require('./routes/submissions')(db, notify));
app.use('/api/notifications', require('./routes/notifications')(db));

// Companies list for agents
const { verifyToken } = require('./middleware/auth');
app.get('/api/companies', verifyToken, (req, res) => {
  if (!['agent', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Denied' });
  const companies = db.prepare("SELECT id,company_name,industry,country FROM users WHERE role='company' AND is_active=1 ORDER BY company_name").all();
  res.json({ companies });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  Insightbridge Platform v2.0`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Admin:    ${process.env.ADMIN_EMAIL}`);
  console.log(`  Approver: ${process.env.APPROVER_EMAIL}`);
  console.log(`  Agent:    ${process.env.AGENT_EMAIL}\n`);
});
