/* CareerForge AI — frontend logic
 * All DOM access is null-safe. The IIFE only runs after DOMContentLoaded
 * (defer in the script tag handles this too — belt and suspenders).
 */
(function () {
  'use strict';

  function init() {

    // ─── Tiny null-safe helpers ──────────────────
    const $  = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const byId = (id) => document.getElementById(id);
    const on = (el, ev, fn, opts) => { if (el) el.addEventListener(ev, fn, opts); };
    const setText = (el, val) => { if (el) el.textContent = val; };
    const setHTML = (el, val) => { if (el) el.innerHTML = val; };

    // ─── Router ──────────────────────────────────
    const PAGES = ['home','resume','cover','tools','pricing','dashboard','auth','faq','contact','privacy','terms'];

    function route() {
      let hash = (location.hash || '#home').replace('#', '');
      let parts = hash.split('?');
      let page = parts[0];
      let query = parts[1];
      if (!PAGES.includes(page)) page = 'home';

      $$('.page').forEach((p) => p.classList.remove('active'));
      const target = byId('page-' + page);
      if (target) target.classList.add('active');

      // Update nav active states
      $$('.nav-links a, .mobile-sheet a').forEach((a) => {
        const href = a.getAttribute('href') || '';
        const linkPage = href.replace('#', '').split('?')[0];
        a.classList.toggle('active', linkPage === page);
      });

      if (page === 'auth') setAuthMode(query === 'signup' ? 'signup' : 'login');

      try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, 0); }
    }

    on(document, 'click', function (e) {
      const link = e.target && e.target.closest && e.target.closest('[data-link]');
      if (!link) return;
      const href = link.getAttribute('href');
      if (href && href.charAt(0) === '#') {
        e.preventDefault();
        if (location.hash !== href) location.hash = href;
        else route();
        closeMobile();
      }
    });

    on(window, 'hashchange', route);
    route();

    // ─── Mobile menu ─────────────────────────────
    const sheet = byId('mobileSheet');
    function closeMobile() { if (sheet) sheet.classList.remove('open'); }
    on(byId('menuBtn'),  'click', function () { if (sheet) sheet.classList.add('open'); });
    on(byId('menuClose'),'click', closeMobile);
    on(sheet, 'click', function (e) { if (e.target === sheet) closeMobile(); });

    // ─── Toast ───────────────────────────────────
    const toast = byId('toast');
    const toastMsg = byId('toastMsg');
    let toastTimer;
    function showToast(msg) {
      if (!toast || !toastMsg) return;
      toastMsg.textContent = msg;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2400);
    }

    // ─── Resume builder live preview ─────────────
    const form = byId('resumeForm');
    if (form) {
      function updatePreview() {
        const get = function (k) {
          const el = form.querySelector('[data-field="' + k + '"]');
          return el ? el.value : '';
        };
        setText(byId('rp-name'),     get('name'));
        setText(byId('rp-title'),    get('title'));
        setText(byId('rp-email'),    get('email'));
        setText(byId('rp-phone'),    get('phone'));
        setText(byId('rp-location'), get('location'));
        setText(byId('rp-summary'),  get('summary'));
        setText(byId('rp-role1'),    get('role1'));
        setText(byId('rp-dates1'),   get('dates1'));
        setText(byId('rp-company1'), get('company1'));
        setText(byId('rp-education'),get('education'));

        const bullets = get('bullets1').split('\n').filter(function (l) { return l.trim(); });
        setHTML(byId('rp-bullets1'), bullets.map(function (b) { return '<li>' + escapeHtml(b) + '</li>'; }).join(''));

        const skills = get('skills').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        setHTML(byId('rp-skills'), skills.map(function (s) { return '<span>' + escapeHtml(s) + '</span>'; }).join(''));
      }

      form.addEventListener('input', updatePreview);

      form.addEventListener('click', function (e) {
        const btn = e.target && e.target.closest && e.target.closest('[data-action]');
        if (!btn) return;
        e.preventDefault();
        const action = btn.dataset.action;

        if (action === 'generate') {
          btn.disabled = true;
          btn.textContent = 'Generating…';
          setTimeout(function () {
            btn.disabled = false;
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5L7 1z" fill="currentColor"/></svg> Generate Resume';
            updatePreview();
            showToast('Resume generated · ATS-optimized');
          }, 900);
        } else if (action === 'rewrite') {
          const ta = form.querySelector('[data-field="bullets1"]');
          if (!ta) return;
          const original = ta.value.split('\n').filter(function (l) { return l.trim(); });
          const rewrites = [
            'Spearheaded the redesign of the analytics dashboard, driving a 38% lift in weekly active users within two quarters.',
            'Architected and shipped a cross-product design system, adopted by 14 engineering teams and reducing UI inconsistency reports by 62%.',
            'Mentored and onboarded 6 junior designers; cut average ramp-up time from 7 to 4 weeks through structured pairing.'
          ];
          ta.value = rewrites.slice(0, original.length || 3).join('\n');
          updatePreview();
          showToast('Bullets rewritten with stronger verbs and metrics');
        } else if (action === 'download-pdf') {
          showToast('PDF queued · download starting…');
        } else if (action === 'download-docx') {
          showToast('DOCX queued · download starting…');
        }
      });
    }

    // ─── Template pills ──────────────────────────
    $$('.tpill').forEach(function (p) {
      p.addEventListener('click', function () {
        $$('.tpill').forEach(function (x) { x.classList.remove('active'); });
        p.classList.add('active');
        const doc = byId('resumePreview');
        if (doc) {
          doc.classList.remove('tpl-modern', 'tpl-classic', 'tpl-bold');
          doc.classList.add('tpl-' + p.dataset.tpl);
        }
      });
    });

    // ─── ATS Score animation ─────────────────────
    const checkAtsBtn = byId('checkAts');
    on(checkAtsBtn, 'click', function () {
      const ring = byId('scoreRing');
      const val = byId('scoreValue');
      const verdict = byId('scoreVerdict');
      const matched = byId('kwMatched');
      const missed = byId('kwMissed');
      if (!ring || !val) return;

      checkAtsBtn.disabled = true;
      checkAtsBtn.innerHTML = 'Analyzing…';
      if (verdict) verdict.textContent = 'Analyzing keywords and bullet structure…';

      const target = 87;
      let cur = 0;
      const tick = setInterval(function () {
        cur += 3;
        if (cur >= target) { cur = target; clearInterval(tick); finish(); }
        ring.style.setProperty('--p', cur);
        val.innerHTML = cur + '<small>/100</small>';
      }, 22);

      function finish() {
        if (verdict) verdict.innerHTML = 'Strong match. <span>You\'re in the top 12% for this role.</span>';
        setText(matched, '14');
        setText(missed, '3');
        checkAtsBtn.disabled = false;
        checkAtsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5L7 1z" fill="currentColor"/></svg> Re-run check';
        showToast('ATS score updated · 87/100');
      }
    });

    // ─── Cover letter generator ──────────────────
    const genCover = byId('generateCover');
    on(genCover, 'click', function () {
      genCover.disabled = true;
      genCover.textContent = 'Drafting…';
      const get = function (k) {
        const el = document.querySelector('[data-cl="' + k + '"]');
        return el ? el.value : '';
      };
      const name    = get('name')    || 'Maya Okonkwo';
      const manager = get('manager') || 'Hiring Team';
      const company = get('company') || 'the team';
      const role    = get('role')    || 'this role';
      const tone    = get('tone')    || '';

      setTimeout(function () {
        const out = byId('coverOutput');
        if (!out) { genCover.disabled = false; return; }
        const para1 = "I'm writing to apply for the " + role + " role at " + company + ". After eight years of designing tools that help teams work better — most recently at Linear Cloud, where I led the redesign of our analytics platform and shipped a system now used across 14 product teams — the chance to contribute to " + company + "'s next chapter feels like the right next step.";
        const para2 = 'What stands out to me about your team is how seriously you take craft. The way ' + company + " balances ambition with rigor is rare, and it mirrors how I approach systems-level work: making it easy to do the right thing without sacrificing room to invent. I'd bring direct experience leading design systems, embedding research into the design process, and partnering closely with engineering — three threads I noticed running through your description.";
        const para3 = "Beyond the experience listed on my resume, I've spent the past year mentoring junior designers and facilitating discovery workshops with cross-functional partners. I'd love to bring that mix of hands-on craft and team-building energy to " + company + '.';
        const sign = tone.indexOf('Confident') >= 0 ? 'Best,' :
                     tone.indexOf('Enthusiastic') >= 0 ? 'Excited to talk soon,' :
                     tone.indexOf('Concise') >= 0 ? 'Best regards,' : 'Warmly,';

        out.innerHTML =
          '<div class="from">' + escapeHtml(name) + '<br/>maya.okonkwo@mail.co · +1 415 555 0142</div>' +
          '<div class="salute">Dear ' + escapeHtml(manager) + ',</div>' +
          '<p>' + escapeHtml(para1) + '</p>' +
          '<p>' + escapeHtml(para2) + '</p>' +
          '<p>' + escapeHtml(para3) + '</p>' +
          "<p>Thank you for the consideration. I'd welcome the chance to talk.</p>" +
          '<div class="sign">' + sign + '<br/>' + escapeHtml(name.split(' ')[0]) + '</div>';

        genCover.disabled = false;
        genCover.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5L7 1z" fill="currentColor"/></svg> Regenerate';
        updateWordCount();
        showToast('Cover letter generated' + (tone ? ' · ' + tone.toLowerCase() : ''));
      }, 900);
    });

    function updateWordCount() {
      const out = byId('coverOutput');
      const wc = byId('coverWords');
      if (!out || !wc) return;
      const text = (out.innerText || '').trim();
      const words = text ? text.split(/\s+/).length : 0;
      wc.textContent = words + ' words';
    }
    on(byId('coverOutput'), 'input', updateWordCount);

    // ─── Tools grid ──────────────────────────────
    const TOOLS = [
      { cat: 'edit',     name: 'PDF Editor',           desc: 'Edit text, images, and forms in any PDF.',          badge: '' },
      { cat: 'organize', name: 'PDF Merger',           desc: 'Combine multiple PDFs into a single document.',     badge: '' },
      { cat: 'organize', name: 'PDF Splitter',         desc: 'Extract specific pages or split into chunks.',      badge: '' },
      { cat: 'organize', name: 'PDF Compressor',       desc: 'Shrink large PDFs without losing quality.',         badge: '' },
      { cat: 'convert',  name: 'PDF → Word',           desc: 'Convert PDF documents to editable .docx.',          badge: '' },
      { cat: 'convert',  name: 'Word → PDF',           desc: 'Turn .docx files into pixel-perfect PDFs.',         badge: '' },
      { cat: 'ai',       name: 'PDF Summarizer',       desc: 'Get a one-page summary of any long document.',      badge: 'AI' },
      { cat: 'ai',       name: 'File Translator',      desc: 'Translate documents into 30+ languages.',           badge: 'AI' },
      { cat: 'edit',     name: 'Extract Text',         desc: 'Pull clean text out of any PDF or scan.',           badge: '' },
      { cat: 'ai',       name: 'AI Document Q&A',      desc: 'Chat with any uploaded file. Ask, get answers.',    badge: 'AI' },
      { cat: 'ai',       name: 'AI Grammar Checker',   desc: 'Spot mistakes and tighten your writing instantly.', badge: 'AI' },
      { cat: 'ai',       name: 'AI Document Rewriter', desc: 'Rewrite documents in a different tone or style.',   badge: 'AI' }
    ];
    const TOOL_ICON = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="2" width="12" height="14" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M6 6h6M6 9h6M6 12h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    const ARROW = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 11l8-8M5 3h6v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function renderTools(cat) {
      const grid = byId('toolsGrid');
      if (!grid) return;
      const list = cat === 'all' ? TOOLS : TOOLS.filter(function (t) { return t.cat === cat; });
      grid.innerHTML = list.map(function (t) {
        return '<div class="tool" tabindex="0">' +
          '<span class="ico">' + TOOL_ICON + '</span>' +
          (t.badge ? '<span class="badge">' + t.badge + '</span>' : '') +
          '<h3>' + escapeHtml(t.name) + '</h3>' +
          '<p>' + escapeHtml(t.desc) + '</p>' +
          '<span class="arrow">' + ARROW + '</span>' +
        '</div>';
      }).join('');
      $$('.tool', grid).forEach(function (el) {
        el.addEventListener('click', function () {
          const h = el.querySelector('h3');
          showToast('Opening ' + (h ? h.textContent : 'tool') + '…');
        });
      });
    }

    on(byId('toolCats'), 'click', function (e) {
      const btn = e.target && e.target.closest && e.target.closest('button');
      if (!btn) return;
      $$('#toolCats button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      renderTools(btn.dataset.cat);
    });
    renderTools('all');

    // ─── Upload zones (visual only) ──────────────
    ['cvUpload', 'toolsUpload'].forEach(function (id) {
      const zone = byId(id);
      if (!zone) return;
      ['dragenter', 'dragover'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('dragover'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('dragover'); });
      });
      zone.addEventListener('drop', function (e) {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) showToast('Uploaded "' + f.name + '" · processing…');
      });
      zone.addEventListener('click', function () { showToast('File picker would open here'); });
    });

    // ─── Pricing toggle ──────────────────────────
    on(byId('billingToggle'), 'click', function (e) {
      const btn = e.target && e.target.closest && e.target.closest('button');
      if (!btn) return;
      $$('#billingToggle button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      const cycle = btn.dataset.cycle;
      $$('[data-month]').forEach(function (el) {
        el.textContent = '$' + (cycle === 'year' ? el.dataset.year : el.dataset.month);
      });
      $$('[data-cycle-label]').forEach(function (el) {
        el.textContent = cycle === 'year' ? '/ month, billed yearly' : '/ month';
      });
    });

    // ─── Auth tabs ───────────────────────────────
    function setAuthMode(mode) {
      $$('#authTabs button').forEach(function (b) {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
      const isSignup = mode === 'signup';
      setText(byId('authTitle'), isSignup ? 'Create your account' : 'Welcome back');
      setText(byId('authSub'),   isSignup ? 'Start with one free resume — no credit card needed.' : 'Sign in to continue your applications.');
      const nf = byId('nameField');
      if (nf) nf.style.display = isSignup ? 'block' : 'none';
      const sub = byId('authSubmit');
      if (sub) sub.textContent = isSignup ? 'Create account' : 'Log in';
    }

    on(byId('authTabs'), 'click', function (e) {
      const btn = e.target && e.target.closest && e.target.closest('button[data-mode]');
      if (btn) setAuthMode(btn.dataset.mode);
    });

    on(byId('authSubmit'), 'click', function (e) {
      e.preventDefault();
      showToast('Demo only — connect Stripe & auth backend for production');
      setTimeout(function () { location.hash = '#dashboard'; }, 800);
    });

    // ─── Dashboard nav ───────────────────────────
    $$('.dash-nav button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.dash-nav button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      });
    });

    // ─── Contact form ────────────────────────────
    on(byId('sendContact'), 'click', function (e) {
      e.preventDefault();
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      setTimeout(function () {
        btn.disabled = false;
        btn.textContent = 'Send message';
        showToast("Message sent — we'll be in touch within 24 hours");
        $$('#contactForm input, #contactForm textarea').forEach(function (i) { i.value = ''; });
      }, 800);
    });

    // ─── Helpers ─────────────────────────────────
    function escapeHtml(str) {
      return (str || '').replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
    }
  } // end init()

  // Run after DOM is ready. With `defer` on the script tag, document is already
  // parsed by the time this script executes — but guard anyway as belt-and-suspenders.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
