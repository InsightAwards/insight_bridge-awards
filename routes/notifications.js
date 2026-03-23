const express = require('express');
const { verifyToken } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(verifyToken);

  router.get('/', (req, res) => {
    const notifs = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
    const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
    res.json({ notifications: notifs, unread });
  });

  router.patch('/:id/read', (req, res) => {
    db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
    res.json({ success: true });
  });

  router.patch('/read-all', (req, res) => {
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
    res.json({ success: true });
  });

  return router;
};
