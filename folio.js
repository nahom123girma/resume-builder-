/* ==========================================================================
   Folio — shared JS
   Auth (localStorage), resume storage, 5 template renderers, helpers.
   Demo-grade auth: passwords are SHA-256 hashed but this is client-side
   only. For real production, do auth server-side with bcrypt/argon2.
   ========================================================================== */

// ============ STORAGE KEYS ============
const LS = {
  USERS: 'folio_users',
  SESSION: 'folio_session',
  resumesFor: (email) => `folio_resumes_${email}`,
  draftKey: 'folio_draft',
};

// ============ HELPERS ============
async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function uid() {
  return 'r_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function saveJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

// ============ AUTH ============
async function signup({ name, email, password }) {
  email = email.trim().toLowerCase();
  if (!email || !password || password.length < 6) {
    throw new Error('Email and a password of 6+ characters required.');
  }
  const users = loadJSON(LS.USERS, {});
  if (users[email]) throw new Error('That email is already registered. Try logging in.');
  const passHash = await sha256(password);
  users[email] = { name: name || email.split('@')[0], passHash, createdAt: Date.now() };
  saveJSON(LS.USERS, users);
  saveJSON(LS.SESSION, { email });
  return users[email];
}

async function login({ email, password }) {
  email = email.trim().toLowerCase();
  const users = loadJSON(LS.USERS, {});
  const user = users[email];
  if (!user) throw new Error('No account with that email.');
  const passHash = await sha256(password);
  if (passHash !== user.passHash) throw new Error('Incorrect password.');
  saveJSON(LS.SESSION, { email });
  return user;
}

function logout() {
  localStorage.removeItem(LS.SESSION);
}

function getSession() {
  return loadJSON(LS.SESSION, null);
}

function getCurrentUser() {
  const s = getSession();
  if (!s) return null;
  const users = loadJSON(LS.USERS, {});
  return users[s.email] ? { email: s.email, ...users[s.email] } : null;
}

function isLoggedIn() { return !!getCurrentUser(); }

// ============ RESUMES ============
function listResumes() {
  const u = getCurrentUser();
  if (!u) return [];
  return loadJSON(LS.resumesFor(u.email), []);
}

function saveResume(resume) {
  const u = getCurrentUser();
  if (!u) throw new Error('Not logged in.');
  const all = listResumes();
  const idx = all.findIndex(r => r.id === resume.id);
  resume.updatedAt = Date.now();
  if (idx >= 0) all[idx] = resume;
  else { resume.createdAt = Date.now(); all.unshift(resume); }
  saveJSON(LS.resumesFor(u.email), all);
  return resume;
}

function getResume(id) {
  return listResumes().find(r => r.id === id);
}

function deleteResume(id) {
  const u = getCurrentUser();
  if (!u) return;
  const all = listResumes().filter(r => r.id !== id);
  saveJSON(LS.resumesFor(u.email), all);
}

// Draft (used by guests before signup, so they don't lose work)
function saveDraft(resume) { saveJSON(LS.draftKey, resume); }
function getDraft() { return loadJSON(LS.draftKey, null); }
function clearDraft() { localStorage.removeItem(LS.draftKey); }

// ============ SAMPLE DATA ============
const SAMPLE_RESUME = {
  data: {
    name: 'Maya Hernandez',
    title: 'Senior Product Designer',
    email: 'maya@folio.studio',
    phone: '+1 (415) 555 0117',
    location: 'San Francisco, CA',
    website: 'mayahernandez.design',
    linkedin: 'linkedin.com/in/mayah',
    summary: "Senior product designer with 8 years shipping 0→1 products at venture-backed startups. Specialise in design systems, dense data UIs, and the kind of unglamorous CRUD work that makes a product actually usable.",
    experience: [
      {
        title: 'Senior Product Designer', company: 'Linear',
        location: 'Remote', start: 'Mar 2022', end: 'Present',
        bullets: [
          'Led design for the Insights product line, taking it from prototype to general availability across 2,300+ teams.',
          'Built and maintained Linear\'s design-system primitives, reducing component duplication by 64% across 8 product surfaces.',
          'Mentored 4 junior designers; ran weekly critique that became the team\'s most-attended ritual.',
        ],
      },
      {
        title: 'Product Designer', company: 'Notion',
        location: 'San Francisco', start: 'Jun 2019', end: 'Feb 2022',
        bullets: [
          'Designed Notion\'s first iOS-native editor; shipped to 2M+ users in the first quarter.',
          'Owned the onboarding redesign that lifted activation from 41% → 58% over 9 months.',
        ],
      },
    ],
    education: [
      { degree: 'BFA, Communication Design', school: 'Parsons School of Design',
        location: 'New York, NY', start: '2015', end: '2019' },
    ],
    skills: ['Product Design', 'Design Systems', 'Figma', 'Prototyping',
             'User Research', 'SwiftUI', 'React', 'CSS'],
  },
};

const EMPTY_RESUME_DATA = {
  name: '', title: '', email: '', phone: '', location: '', website: '', linkedin: '',
  summary: '',
  experience: [],
  education: [],
  skills: [],
};

// ============ TEMPLATES ============
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function bulletList(bs) {
  if (!bs?.length) return '';
  return `<ul>${bs.map(b => `<li>${escape(b)}</li>`).join('')}</ul>`;
}

const TEMPLATES = {
  // 1 — BROADSHEET (classic, single column, serif)
  broadsheet: {
    name: 'Broadsheet',
    tag: 'CLASSIC',
    desc: 'Single-column serif. Newspaper-style. Reads quietly, prints clean.',
    render: (d) => `
<article class="tpl tpl-broadsheet">
  <header>
    <h1>${escape(d.name) || 'Your name'}</h1>
    <div class="role">${escape(d.title) || 'Your title'}</div>
    <div class="contact">
      ${[d.email, d.phone, d.location, d.website].filter(Boolean).map(escape).join(' · ')}
    </div>
  </header>
  ${d.summary ? `<section><h2>Summary</h2><p>${escape(d.summary)}</p></section>` : ''}
  ${d.experience?.length ? `<section><h2>Experience</h2>
    ${d.experience.map(x => `
      <div class="entry">
        <div class="row">
          <span><strong>${escape(x.title)}</strong>${x.company ? `, <em>${escape(x.company)}</em>` : ''}</span>
          <span class="dates">${escape(x.start)}${x.end ? ' — ' + escape(x.end) : ''}</span>
        </div>
        ${bulletList(x.bullets)}
      </div>`).join('')}
  </section>` : ''}
  ${d.education?.length ? `<section><h2>Education</h2>
    ${d.education.map(e => `
      <div class="row">
        <span><strong>${escape(e.degree)}</strong>${e.school ? `, <em>${escape(e.school)}</em>` : ''}</span>
        <span class="dates">${escape(e.start)}${e.end ? ' — ' + escape(e.end) : ''}</span>
      </div>`).join('')}
  </section>` : ''}
  ${d.skills?.length ? `<section><h2>Skills</h2><p class="skills">${d.skills.map(escape).join(' · ')}</p></section>` : ''}
</article>`
  },

  // 2 — SIDEBAR (modern, dark left rail, two-column)
  sidebar: {
    name: 'Sidebar',
    tag: 'MODERN',
    desc: 'Dark left rail with contact and skills. Bold. Recruiter-friendly.',
    render: (d) => `
<article class="tpl tpl-sidebar">
  <aside>
    <div class="ident">
      <div class="ident-name">${escape(d.name) || 'Your name'}</div>
      <div class="ident-role">${escape(d.title) || 'Your title'}</div>
    </div>
    <div class="aside-block">
      <h3>Contact</h3>
      ${d.email ? `<div>${escape(d.email)}</div>` : ''}
      ${d.phone ? `<div>${escape(d.phone)}</div>` : ''}
      ${d.location ? `<div>${escape(d.location)}</div>` : ''}
      ${d.website ? `<div>${escape(d.website)}</div>` : ''}
      ${d.linkedin ? `<div>${escape(d.linkedin)}</div>` : ''}
    </div>
    ${d.skills?.length ? `<div class="aside-block">
      <h3>Skills</h3>
      ${d.skills.map(s => `<div>${escape(s)}</div>`).join('')}
    </div>` : ''}
  </aside>
  <main>
    ${d.summary ? `<section><h2>Profile</h2><p>${escape(d.summary)}</p></section>` : ''}
    ${d.experience?.length ? `<section><h2>Experience</h2>
      ${d.experience.map(x => `
        <div class="entry">
          <div class="row">
            <span><strong>${escape(x.title)}</strong></span>
            <span class="dates">${escape(x.start)}${x.end ? ' — ' + escape(x.end) : ''}</span>
          </div>
          <div class="company">${escape(x.company)}${x.location ? ' · ' + escape(x.location) : ''}</div>
          ${bulletList(x.bullets)}
        </div>`).join('')}
    </section>` : ''}
    ${d.education?.length ? `<section><h2>Education</h2>
      ${d.education.map(e => `
        <div class="row">
          <span><strong>${escape(e.degree)}</strong>${e.school ? ', ' + escape(e.school) : ''}</span>
          <span class="dates">${escape(e.start)}${e.end ? ' — ' + escape(e.end) : ''}</span>
        </div>`).join('')}
    </section>` : ''}
  </main>
</article>`
  },

  // 3 — EDITORIAL (magazine-style, italic display, serif)
  editorial: {
    name: 'Editorial',
    tag: 'SERIF',
    desc: 'Italic display name and grid layout. Magazine-style. Memorable.',
    render: (d) => `
<article class="tpl tpl-editorial">
  <header>
    <h1>${escape(d.name) || 'Your name'}</h1>
    <div class="role">${escape(d.title) || 'Your title'}</div>
  </header>
  <div class="grid">
    <aside>
      <div class="ed-block">
        <h3>Contact</h3>
        ${d.email ? `<div>${escape(d.email)}</div>` : ''}
        ${d.phone ? `<div>${escape(d.phone)}</div>` : ''}
        ${d.location ? `<div>${escape(d.location)}</div>` : ''}
        ${d.website ? `<div>${escape(d.website)}</div>` : ''}
      </div>
      ${d.skills?.length ? `<div class="ed-block">
        <h3>Skills</h3>
        <p>${d.skills.map(escape).join(' · ')}</p>
      </div>` : ''}
      ${d.education?.length ? `<div class="ed-block">
        <h3>Education</h3>
        ${d.education.map(e => `
          <div><strong>${escape(e.degree)}</strong></div>
          <div class="ed-meta">${escape(e.school)}${e.end ? ' · ' + escape(e.end) : ''}</div>`).join('')}
      </div>` : ''}
    </aside>
    <main>
      ${d.summary ? `<section><p class="lede">${escape(d.summary)}</p></section>` : ''}
      ${d.experience?.length ? `<section>
        <h2>Experience</h2>
        ${d.experience.map(x => `
          <div class="entry">
            <div class="ed-title">${escape(x.title)}<span class="ed-comma">,</span> <em>${escape(x.company)}</em></div>
            <div class="ed-meta">${escape(x.start)}${x.end ? ' — ' + escape(x.end) : ''}${x.location ? ' · ' + escape(x.location) : ''}</div>
            ${bulletList(x.bullets)}
          </div>`).join('')}
      </section>` : ''}
    </main>
  </div>
</article>`
  },

  // 4 — WHISPER (minimal, lowercase, sans-serif, lots of whitespace)
  whisper: {
    name: 'Whisper',
    tag: 'MINIMAL',
    desc: 'Lowercase, sans-serif, generous whitespace. Less is more.',
    render: (d) => `
<article class="tpl tpl-whisper">
  <header>
    <h1>${(d.name || 'your name').toLowerCase()}.</h1>
    <div class="role">${(d.title || 'your title').toLowerCase()}</div>
    <div class="contact">
      ${[d.email, d.phone, d.location, d.website].filter(Boolean).map(s => escape(s).toLowerCase()).join('  /  ')}
    </div>
  </header>
  ${d.summary ? `<section>${escape(d.summary)}</section>` : ''}
  ${d.experience?.length ? `<section>
    <h2>experience</h2>
    ${d.experience.map(x => `
      <div class="entry">
        <div class="title">${escape(x.title).toLowerCase()} · ${escape(x.company).toLowerCase()}</div>
        <div class="dates">${escape(x.start).toLowerCase()}${x.end ? ' — ' + escape(x.end).toLowerCase() : ''}</div>
        ${bulletList(x.bullets)}
      </div>`).join('')}
  </section>` : ''}
  ${d.education?.length ? `<section>
    <h2>education</h2>
    ${d.education.map(e => `
      <div class="entry">
        <div class="title">${escape(e.degree).toLowerCase()}</div>
        <div class="dates">${escape(e.school).toLowerCase()}${e.end ? '  —  ' + escape(e.end).toLowerCase() : ''}</div>
      </div>`).join('')}
  </section>` : ''}
  ${d.skills?.length ? `<section>
    <h2>skills</h2>
    <div class="skills">${d.skills.map(s => escape(s).toLowerCase()).join(' · ')}</div>
  </section>` : ''}
</article>`
  },

  // 5 — COMPACT (dense two-column, fits a lot, designed for senior CVs)
  compact: {
    name: 'Compact',
    tag: 'DENSE',
    desc: 'Two-column dense layout. Maximizes content on one page. For senior CVs.',
    render: (d) => `
<article class="tpl tpl-compact">
  <header>
    <h1>${escape(d.name) || 'Your name'}</h1>
    <div class="role">${escape(d.title) || 'Your title'}</div>
    <div class="contact">
      ${[d.email, d.phone, d.location, d.website, d.linkedin].filter(Boolean).map(escape).join(' &nbsp;·&nbsp; ')}
    </div>
  </header>
  <hr/>
  ${d.summary ? `<section class="full"><strong>SUMMARY.</strong> ${escape(d.summary)}</section>` : ''}
  <div class="cols">
    <div class="left-col">
      ${d.experience?.length ? `<section><h2>Experience</h2>
        ${d.experience.map(x => `
          <div class="entry">
            <div class="row"><strong>${escape(x.title)}</strong><span class="dates">${escape(x.start)}${x.end ? '–' + escape(x.end) : ''}</span></div>
            <div class="company"><em>${escape(x.company)}</em>${x.location ? ', ' + escape(x.location) : ''}</div>
            ${bulletList(x.bullets)}
          </div>`).join('')}
      </section>` : ''}
    </div>
    <div class="right-col">
      ${d.skills?.length ? `<section><h2>Skills</h2>
        <p>${d.skills.map(escape).join(' · ')}</p>
      </section>` : ''}
      ${d.education?.length ? `<section><h2>Education</h2>
        ${d.education.map(e => `
          <div class="entry">
            <div><strong>${escape(e.degree)}</strong></div>
            <div class="company"><em>${escape(e.school)}</em></div>
            <div class="dates">${escape(e.start)}${e.end ? ' — ' + escape(e.end) : ''}</div>
          </div>`).join('')}
      </section>` : ''}
    </div>
  </div>
</article>`
  },
};

// ============ NAV / TOAST UI HELPERS ============
function renderNav() {
  const u = getCurrentUser();
  const target = document.querySelector('.nav-cta');
  if (!target) return;
  if (u) {
    target.innerHTML = `
      <a href="dashboard.html" class="btn btn-ghost">My résumés</a>
      <a href="builder.html" class="btn btn-primary">+ New</a>
      <button class="btn btn-ghost" id="nav-logout">Log out</button>
    `;
    document.getElementById('nav-logout').addEventListener('click', () => {
      logout();
      location.href = 'index.html';
    });
  } else {
    target.innerHTML = `
      <a href="auth.html?mode=login" class="btn btn-ghost">Log in</a>
      <a href="auth.html?mode=signup" class="btn btn-primary">Get started</a>
    `;
  }
}

function toast(msg, ms = 2500) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span class="toast-dot"></span> ${msg}`;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

// Auto-init: render auth-aware nav on every page that has a .nav-cta slot
document.addEventListener('DOMContentLoaded', renderNav);
