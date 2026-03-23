/**
 * Agent Routes — Company profile creation, shareable links, agent dashboard
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { verifyToken, requireRole } = require('../middleware/auth');

module.exports = function(db, notify, emailService) {
  const router = express.Router();
  router.use(verifyToken, requireRole('agent', 'admin'));

  // ── Agent Dashboard Stats ──────────────────────────────
  router.get('/dashboard', (req, res) => {
    const agentId = req.user.id;
    const stats = {
      total_companies: db.prepare("SELECT COUNT(*) as c FROM users WHERE role='company' AND created_by=?").get(agentId)?.c || 0,
      total_submissions: db.prepare("SELECT COUNT(*) as c FROM submissions WHERE submitted_by=?").get(agentId).c,
      approved: db.prepare("SELECT COUNT(*) as c FROM submissions WHERE submitted_by=? AND status IN ('approved','ai_approved')").get(agentId).c,
      pending: db.prepare("SELECT COUNT(*) as c FROM submissions WHERE submitted_by=? AND status IN ('pending_review','title_conflict')").get(agentId).c,
      rejected: db.prepare("SELECT COUNT(*) as c FROM submissions WHERE submitted_by=? AND status='rejected'").get(agentId).c,
      drafts: db.prepare("SELECT COUNT(*) as c FROM submissions WHERE submitted_by=? AND status='draft'").get(agentId).c,
    };

    // Recent submissions by this agent
    const recent = db.prepare(`
      SELECT s.id, s.status, s.ai_score, s.ai_verdict, s.award_title, s.submitted_at, s.created_at,
             u.company_name, u.industry
      FROM submissions s JOIN users u ON s.user_id=u.id
      WHERE s.submitted_by=?
      ORDER BY s.created_at DESC LIMIT 10
    `).all(agentId);

    // Companies created by this agent
    const companies = db.prepare(`
      SELECT u.id, u.company_name, u.contact_person, u.email, u.industry, u.country, u.is_active, u.created_at,
             COUNT(s.id) as submission_count,
             SUM(CASE WHEN s.status IN ('approved','ai_approved') THEN 1 ELSE 0 END) as approved_count
      FROM users u LEFT JOIN submissions s ON u.id=s.user_id
      WHERE u.role='company' AND u.created_by=?
      GROUP BY u.id ORDER BY u.created_at DESC
    `).all(agentId);

    res.json({ stats, recent, companies });
  });

  // ── Create Company Profile ─────────────────────────────
  router.post('/companies', (req, res) => {
    const { company_name, contact_person, email, phone, industry, country, website } = req.body;
    if (!company_name || !email) return res.status(400).json({ error: 'Company name and email are required' });

    const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const tempPassword = genPassword();
    const id = uuidv4();
    db.prepare(`INSERT INTO users (id,email,password,role,company_name,contact_person,phone,industry,country,website,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, email.toLowerCase().trim(), bcrypt.hashSync(tempPassword, 10), 'company', company_name, contact_person||'', phone||'', industry||'', country||'', website||'', req.user.id);

    db.prepare('INSERT INTO audit_log (action,actor,actor_role,target_id,details) VALUES (?,?,?,?,?)')
      .run('AGENT_CREATE_COMPANY', req.user.id, req.user.role, id, `Agent created company: ${company_name} (${email})`);

    notify(id, 'welcome', 'Welcome to Insightbridge Awards', `Your company profile has been created by our team. You can now log in and manage your award submissions.`, '#/dashboard');

    // Send welcome email
    const loginUrl = `${process.env.BASE_URL || 'https://insightbridge-awards.onrender.com'}/#/login`;
    emailService.welcomeCompany({ companyName: company_name, contactPerson: contact_person, email: email.toLowerCase().trim(), tempPassword, loginUrl });

    // Generate shareable link
    const shareLink = `${process.env.BASE_URL || 'https://insightbridge-awards.onrender.com'}/#/login?company=${encodeURIComponent(id)}`;

    res.json({ id, email: email.toLowerCase().trim(), temporary_password: tempPassword, company_name, share_link: shareLink });
  });

  // ── Get Agent's Companies ──────────────────────────────
  router.get('/companies', (req, res) => {
    const companies = db.prepare(`
      SELECT u.id, u.company_name, u.contact_person, u.email, u.phone, u.industry, u.country, u.website, u.is_active, u.created_at,
             COUNT(s.id) as submission_count,
             SUM(CASE WHEN s.status IN ('approved','ai_approved') THEN 1 ELSE 0 END) as approved_count
      FROM users u LEFT JOIN submissions s ON u.id=s.user_id
      WHERE u.role='company' AND u.created_by=?
      GROUP BY u.id ORDER BY u.created_at DESC
    `).all(req.user.id);
    res.json({ companies });
  });

  return router;
};

function genPassword() {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let p = ''; for (let i = 0; i < 10; i++) p += c[Math.floor(Math.random()*c.length)];
  return p + '!@#$%'[Math.floor(Math.random()*5)];
}
