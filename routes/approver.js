const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { verifyToken, requireRole } = require('../middleware/auth');

module.exports = function(db, notify, emailService) {
  const router = express.Router();
  router.use(verifyToken, requireRole('approver', 'admin'));

  // Approver dashboard
  router.get('/dashboard', (req, res) => {
    const stats = {
      pending: db.prepare("SELECT COUNT(*) as c FROM submissions WHERE status IN ('pending_review','title_conflict')").get().c,
      ai_approved: db.prepare("SELECT COUNT(*) as c FROM submissions WHERE status='ai_approved'").get().c,
      approved: db.prepare("SELECT COUNT(*) as c FROM submissions WHERE status='approved'").get().c,
      rejected: db.prepare("SELECT COUNT(*) as c FROM submissions WHERE status='rejected'").get().c,
      total_titles: db.prepare('SELECT COUNT(*) as c FROM award_titles').get().c,
    };
    const pending = db.prepare(`
      SELECT s.id,s.award_title,s.award_category,s.ai_score,s.ai_probability,s.ai_verdict,s.status,s.submitted_at,s.title_conflicts,s.submitted_by_role,
             u.company_name,u.industry,u.country
      FROM submissions s JOIN users u ON s.user_id=u.id
      WHERE s.status IN ('pending_review','title_conflict','ai_approved')
      ORDER BY CASE s.status WHEN 'title_conflict' THEN 0 WHEN 'pending_review' THEN 1 ELSE 2 END, s.submitted_at ASC
    `).all();
    pending.forEach(p => { try { p.title_conflicts = JSON.parse(p.title_conflicts||'null'); } catch {} });
    res.json({ stats, pending });
  });

  // Approve submission
  router.post('/:id/approve', (req, res) => {
    const { notes, override_title } = req.body;
    const sub = db.prepare('SELECT s.*,u.company_name FROM submissions s JOIN users u ON s.user_id=u.id WHERE s.id=?').get(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Not found' });
    if (!['pending_review', 'title_conflict', 'ai_approved'].includes(sub.status))
      return res.status(400).json({ error: 'Cannot approve in current status' });

    const finalTitle = override_title || sub.award_title;
    const now = new Date().toISOString();

    db.prepare(`UPDATE submissions SET status='approved',approved_at=?,approved_by=?,approver_notes=?,award_title=? WHERE id=?`)
      .run(now, req.user.id, notes||'', finalTitle, sub.id);

    // Register title
    if (finalTitle) {
      db.prepare('INSERT INTO award_titles (id,title,category,company_id,company_name,submission_id,year) VALUES (?,?,?,?,?,?,?)')
        .run(uuidv4(), finalTitle, sub.award_category, sub.user_id, sub.company_name, sub.id, new Date().getFullYear());
    }

    db.prepare('INSERT INTO audit_log (action,actor,actor_role,target_id,details) VALUES (?,?,?,?,?)')
      .run('APPROVE', req.user.id, req.user.role, sub.id, `Approved: "${finalTitle}" for ${sub.company_name}`);

    notify(sub.user_id, 'approved', 'Award Approved!', `Congratulations! "${finalTitle}" has been approved by the Award Committee.${notes ? ' Notes: ' + notes : ''}`, `#/submission/${sub.id}`);

    // Notify agents if submitted by agent
    if (sub.submitted_by && sub.submitted_by !== sub.user_id) {
      notify(sub.submitted_by, 'approved', 'Submission Approved', `"${finalTitle}" for ${sub.company_name} has been approved.`, `#/submission/${sub.id}`);
    }

    res.json({ success: true, status: 'approved' });
  });

  // Reject submission
  router.post('/:id/reject', (req, res) => {
    const { reason } = req.body;
    const sub = db.prepare('SELECT s.*,u.company_name FROM submissions s JOIN users u ON s.user_id=u.id WHERE s.id=?').get(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Not found' });

    db.prepare(`UPDATE submissions SET status='rejected',rejection_reason=?,approved_by=? WHERE id=?`)
      .run(reason||'Does not meet award criteria', req.user.id, sub.id);

    db.prepare('INSERT INTO audit_log (action,actor,actor_role,target_id,details) VALUES (?,?,?,?,?)')
      .run('REJECT', req.user.id, req.user.role, sub.id, `Rejected: ${sub.company_name} — ${reason||'N/A'}`);

    notify(sub.user_id, 'rejected', 'Submission Not Approved', `Your submission "${sub.award_title || sub.award_category}" was not approved.${reason ? ' Reason: ' + reason : ''}`, `#/submission/${sub.id}`);

    res.json({ success: true, status: 'rejected' });
  });

  // Request revision
  router.post('/:id/revision', (req, res) => {
    const { notes } = req.body;
    const sub = db.prepare('SELECT s.*,u.company_name FROM submissions s JOIN users u ON s.user_id=u.id WHERE s.id=?').get(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Not found' });

    db.prepare(`UPDATE submissions SET status='revision_requested',approver_notes=? WHERE id=?`).run(notes||'', sub.id);

    notify(sub.user_id, 'warning', 'Revision Requested', `Your submission needs revision.${notes ? ' Feedback: ' + notes : ''}`, `#/submission/${sub.id}`);

    res.json({ success: true, status: 'revision_requested' });
  });

  return router;
};
