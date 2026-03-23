const express = require('express');
const bcrypt = require('bcryptjs');
const { generateToken, verifyToken } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase().trim());
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Invalid credentials' });
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    db.prepare('INSERT INTO audit_log (action, actor, actor_role, details) VALUES (?,?,?,?)').run('LOGIN', user.id, user.role, `${user.role} login: ${user.email}`);
    res.json({
      token: generateToken(user),
      user: { id: user.id, email: user.email, role: user.role, company_name: user.company_name, contact_person: user.contact_person }
    });
  });

  router.get('/me', verifyToken, (req, res) => {
    const user = db.prepare('SELECT id,email,role,company_name,contact_person,industry,country,website,created_at,last_login FROM users WHERE id=?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
    res.json({ user, unread_notifications: unread });
  });

  router.put('/password', verifyToken, (req, res) => {
    const { current_password, new_password } = req.body;
    const user = db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
    if (!bcrypt.compareSync(current_password, user.password)) return res.status(400).json({ error: 'Current password incorrect' });
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(new_password, 10), req.user.id);
    res.json({ success: true });
  });

  return router;
};
