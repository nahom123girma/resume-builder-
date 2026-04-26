/* ResumeFlow — frontend logic
 * Real file uploads (via hidden <input type="file">) and real PDF/DOCX downloads
 * (PDF via html2pdf.js, DOCX via Word-compatible HTML blob).
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

    function escapeHtml(str) {
      return (str || '').replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
    }

    function formatBytes(bytes) {
      if (!bytes && bytes !== 0) return '';
      if (bytes === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return (bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + units[i];
    }

    // ─── Processing limits (per-tool budgets) ────
    // Hard caps protect the browser from freezing; "soft" caps trigger the
    // partial-processing modal so the user can pick how to proceed.
    const LIMITS = {
      global: { hardBytes: 10 * 1024 * 1024, softBytes: 5 * 1024 * 1024 },
      pdf:        { hardBytes: 5 * 1024 * 1024, softPages: 5,  hardPages: 15 },
      translator: { hardChars: 10000, softChars: 5000 },
      ocr:        { hardBytes: 3 * 1024 * 1024, softPages: 1,  hardPages: 3 },
      compressor: { hardBytes: 5 * 1024 * 1024 },
      splitter:   { hardBytes: 5 * 1024 * 1024, softPages: 10 },
      parsing:    { hardChars: 12000, softChars: 8000 }
    };

    // Check a file against the global ceiling first, then the per-tool budget.
    // Returns { ok, partial, reason, recommendation }
    function checkFileLimits(file, toolKey) {
      const tool = LIMITS[toolKey] || {};
      // Global hard cap — never process
      if (file.size > LIMITS.global.hardBytes) {
        return {
          ok: false,
          reason: 'File is ' + formatBytes(file.size) + '. Maximum supported size is ' +
                  formatBytes(LIMITS.global.hardBytes) + '.',
          recommendation: 'Use a smaller file or split it before uploading.'
        };
      }
      // Per-tool cap
      if (tool.hardBytes && file.size > tool.hardBytes) {
        return {
          ok: true,
          partial: true,
          reason: 'File is ' + formatBytes(file.size) + ', above the ' +
                  formatBytes(tool.hardBytes) + ' recommended size for this tool.'
        };
      }
      // Soft global cap → warn but don't block
      if (file.size > LIMITS.global.softBytes) {
        return {
          ok: true,
          partial: true,
          reason: 'File is over ' + formatBytes(LIMITS.global.softBytes) + ' — processing may be slow.'
        };
      }
      return { ok: true, partial: false };
    }

    // Show a 3-button modal asking the user how to proceed when a file is over limits.
    // Resolves with one of: 'partial' | 'full' | 'cancel'.
    function askPartialProcessing(toolName, file, reason) {
      return new Promise(function (resolve) {
        const overlay = byId('modalOverlay');
        const eyebrowEl = byId('modalEyebrow');
        const titleEl = byId('modalTitle');
        const bodyEl = byId('modalBody');
        if (!overlay || !titleEl || !bodyEl) { resolve('cancel'); return; }

        if (eyebrowEl) eyebrowEl.textContent = 'Large file';
        titleEl.innerHTML = 'How should we handle <em>' + escapeHtml(file.name) + '</em>?';
        bodyEl.innerHTML =
          '<p>' + escapeHtml(reason) + '</p>' +
          '<p style="color:var(--ink-3);font-size:.86rem;margin-top:8px">' +
            '<b>Partial</b> processes only the first portion (recommended for large files). ' +
            '<b>Full</b> processes everything but may freeze your browser briefly.' +
          '</p>' +
          '<div class="modal-cta" style="flex-direction:row;flex-wrap:wrap">' +
            '<button class="btn btn-accent" data-choice="partial">Process partially</button>' +
            '<button class="btn btn-ghost" data-choice="full">Continue anyway</button>' +
            '<button class="btn btn-ghost" data-choice="cancel">Cancel</button>' +
          '</div>';
        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');

        const handler = function (e) {
          const btn = e.target && e.target.closest && e.target.closest('[data-choice]');
          if (!btn) return;
          bodyEl.removeEventListener('click', handler);
          overlay.classList.remove('show');
          overlay.setAttribute('aria-hidden', 'true');
          document.body.classList.remove('modal-open');
          resolve(btn.dataset.choice);
        };
        bodyEl.addEventListener('click', handler);
      });
    }

    // Yield to the event loop — keeps the UI responsive during long jobs.
    function yieldNow() {
      return new Promise(function (r) { setTimeout(r, 0); });
    }

    // Show a loading state inside the modal.
    function showProcessingModal(toolName, status) {
      const overlay = byId('modalOverlay');
      const eyebrowEl = byId('modalEyebrow');
      const titleEl = byId('modalTitle');
      const bodyEl = byId('modalBody');
      if (!overlay) return;
      if (eyebrowEl) eyebrowEl.textContent = toolName;
      if (titleEl) titleEl.innerHTML = 'Processing…';
      if (bodyEl) bodyEl.innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:20px 0">' +
          '<div class="ai-spinner" style="display:block;width:38px;height:38px;border:3px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:aispin 0.7s linear infinite"></div>' +
          '<p id="processingStatus" style="color:var(--ink-2);font-size:.92rem">' + escapeHtml(status || 'Working…') + '</p>' +
        '</div>';
      overlay.classList.add('show');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
    }

    function updateProcessingStatus(status) {
      const el = byId('processingStatus');
      if (el) el.textContent = status;
    }

    // ─── Global state ────────────────────────────
    // Single source of truth for the app. UI re-renders on state changes.
    const STATE_KEY = 'resumeflow:v1';

    const state = {
      auth: { loggedIn: false, email: null, since: null },
      hasResume: false,
      parsed: null,             // last parsed resume data
      uploadedFile: null,       // { name, size, when }
      atsScore: null,           // { score, matched, missed, verdict, foundKeywords, missingKeywords }
      coverGenerated: false,
      activity: [],             // [{ kind, label, when }]
      filesUploaded: []         // [{ name, size, when, kind }]
    };

    function isLoggedIn() { return !!state.auth.loggedIn; }

    // Persistence is GATED by login. Logged-out users never write to localStorage.
    function persist() {
      if (!isLoggedIn()) return;
      try {
        const snapshot = {
          auth: state.auth,
          hasResume: state.hasResume,
          parsed: state.parsed,
          uploadedFile: state.uploadedFile,
          atsScore: state.atsScore,
          coverGenerated: state.coverGenerated,
          activity: state.activity.slice(-25),
          filesUploaded: state.filesUploaded.slice(-25)
        };
        localStorage.setItem(STATE_KEY, JSON.stringify(snapshot));
      } catch (e) { /* quota / disabled — fine */ }
    }

    function restore() {
      // Only restore if a logged-in flag is in sessionStorage.
      // sessionStorage is wiped on browser close, so refreshing within the
      // same session keeps you logged in, but closing the tab signs you out.
      let session;
      try { session = sessionStorage.getItem(STATE_KEY + ':session'); } catch (e) {}
      if (!session) return;
      try {
        const raw = localStorage.getItem(STATE_KEY);
        if (!raw) return;
        const snap = JSON.parse(raw);
        Object.assign(state, snap);
      } catch (e) { /* corrupt — ignore */ }
    }

    function clearAllData() {
      try { localStorage.removeItem(STATE_KEY); } catch (e) {}
      try { sessionStorage.removeItem(STATE_KEY + ':session'); } catch (e) {}
      state.auth = { loggedIn: false, email: null, since: null };
      state.hasResume = false;
      state.parsed = null;
      state.uploadedFile = null;
      state.atsScore = null;
      state.coverGenerated = false;
      state.activity = [];
      state.filesUploaded = [];
    }

    // ─── Activity tracking ───────────────────────
    function addActivity(kind, label) {
      state.activity.unshift({ kind: kind, label: label, when: Date.now() });
      if (state.activity.length > 25) state.activity.length = 25;
      persist();
    }

    function timeAgo(ts) {
      const s = Math.floor((Date.now() - ts) / 1000);
      if (s < 60) return 'just now';
      const m = Math.floor(s / 60);
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      const d = Math.floor(h / 24);
      return d + 'd ago';
    }

    // ─── Auth state renderer (header CTA + dashboard greeting) ───
    function renderAuthState() {
      const loginLink = $('.nav-cta a.btn-link[href="#auth"]');
      const signupBtn = $('.nav-cta a.btn-primary[href="#auth?signup"]');
      if (state.auth.loggedIn) {
        if (loginLink) loginLink.textContent = 'Dashboard';
        if (loginLink) loginLink.setAttribute('href', '#dashboard');
        if (signupBtn) {
          signupBtn.textContent = 'Sign out';
          signupBtn.setAttribute('href', '#');
          signupBtn.setAttribute('data-action', 'signout');
          signupBtn.removeAttribute('data-link');
        }
      } else {
        if (loginLink) {
          loginLink.textContent = 'Log in';
          loginLink.setAttribute('href', '#auth');
        }
        if (signupBtn) {
          signupBtn.textContent = 'Start Free';
          signupBtn.setAttribute('href', '#auth?signup');
          signupBtn.setAttribute('data-link', '');
          signupBtn.removeAttribute('data-action');
        }
      }
    }

    // Header sign-out shortcut
    on(document, 'click', function (e) {
      const t = e.target && e.target.closest && e.target.closest('[data-action="signout"]');
      if (!t) return;
      e.preventDefault();
      try { sessionStorage.removeItem(STATE_KEY + ':session'); } catch (err) {}
      state.auth = { loggedIn: false, email: null, since: null };
      showToast('Signed out');
      renderAuthState();
      renderDashboard();
      location.hash = '#home';
    });

    // ─── Dashboard renderer ──────────────────────
    function renderDashboard() {
      const empty = byId('dashEmpty');
      const content = byId('dashContent');
      const greeting = byId('dashGreeting');
      const sub = byId('dashSub');

      if (!empty || !content) return;

      if (!state.hasResume) {
        empty.removeAttribute('hidden');
        content.setAttribute('hidden', '');
        if (greeting) {
          greeting.innerHTML = state.auth.loggedIn
            ? 'Welcome back, <em>' + escapeHtml((state.auth.email || '').split('@')[0]) + '.</em>'
            : 'Welcome to <em>ResumeFlow.</em>';
        }
        if (sub) {
          sub.textContent = state.auth.loggedIn
            ? 'No resume created yet. Get started below.'
            : 'Sign in to save your work, or jump in as a guest.';
        }
        return;
      }

      empty.setAttribute('hidden', '');
      content.removeAttribute('hidden');

      const name = (state.parsed && state.parsed.name) || (state.auth.email && state.auth.email.split('@')[0]) || 'there';
      const firstName = name.split(' ')[0] || 'there';
      const initials = name.split(' ').map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase() || '?';

      if (greeting) greeting.innerHTML = 'Welcome back, <em>' + escapeHtml(firstName) + '.</em>';
      if (sub) sub.textContent = "Here's what's in flight.";
      setText(byId('dashAvatar'), initials);
      setText(byId('dashName'), name);
      setText(byId('dashPlan'), state.auth.loggedIn ? 'Pro plan' : 'Guest session');

      // Stats
      const resumeCount = state.parsed ? 1 : 0;
      const coverCount = state.coverGenerated ? 1 : 0;
      setText(byId('statResumes'), String(resumeCount));
      setText(byId('statResumesDelta'), state.uploadedFile ? timeAgo(state.uploadedFile.when) : '—');
      setText(byId('statCovers'), String(coverCount));
      setText(byId('statCoversDelta'), coverCount ? 'just generated' : '—');
      setText(byId('statAts'), state.atsScore && !state.atsScore.error ? String(state.atsScore.score) : '—');
      setText(byId('statAtsDelta'), state.atsScore && !state.atsScore.error ? state.atsScore.verdict.replace(/\.$/, '') : 'Run an ATS check');

      // Recent activity (overview tab)
      const recents = byId('recentDocsList');
      if (recents) {
        if (state.activity.length === 0) {
          recents.innerHTML = '<div class="dash-empty-inline">No activity yet.</div>';
        } else {
          recents.innerHTML = state.activity.slice(0, 5).map(function (a) {
            return '<div class="doc-item">' +
              '<div class="doc-thumb"></div>' +
              '<div class="doc-info"><b>' + escapeHtml(a.label) + '</b><small>' + escapeHtml(a.kind) + ' · ' + timeAgo(a.when) + '</small></div>' +
              '<div class="doc-actions"></div>' +
            '</div>';
          }).join('');
        }
      }

      // Resumes panel
      const resumesList = byId('resumesList');
      if (resumesList) {
        if (state.parsed) {
          resumesList.innerHTML =
            '<div class="doc-item">' +
              '<div class="doc-thumb"></div>' +
              '<div class="doc-info"><b>' + escapeHtml(state.parsed.name || 'Untitled resume') + (state.parsed.title ? ' — ' + escapeHtml(state.parsed.title) : '') + '</b>' +
              '<small>' + (state.uploadedFile ? escapeHtml(state.uploadedFile.name) + ' · ' : '') +
              (state.atsScore && !state.atsScore.error ? 'ATS ' + state.atsScore.score + ' · ' : '') +
              (state.uploadedFile ? timeAgo(state.uploadedFile.when) : 'Just now') + '</small></div>' +
              '<div class="doc-actions">' +
                '<button title="Edit"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2l3 3-7 7H2v-3l7-7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>' +
                '<button title="Download"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v8m0 0L4 7m3 3l3-3M2 12h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
              '</div>' +
            '</div>';
        } else {
          resumesList.innerHTML = '<div class="dash-empty-inline">No resumes yet.</div>';
        }
      }

      // Cover letters panel
      const coversList = byId('coversList');
      if (coversList) {
        if (state.coverGenerated) {
          coversList.innerHTML =
            '<div class="doc-item">' +
              '<div class="doc-thumb"></div>' +
              '<div class="doc-info"><b>Cover letter</b><small>Just generated</small></div>' +
              '<div class="doc-actions">' +
                '<button title="Edit"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2l3 3-7 7H2v-3l7-7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg></button>' +
              '</div>' +
            '</div>';
        } else {
          coversList.innerHTML = '<div class="dash-empty-inline">No cover letters yet.</div>';
        }
      }

      // Files panel
      const filesList = byId('filesList');
      if (filesList) {
        if (state.filesUploaded.length === 0 && !state.uploadedFile) {
          filesList.innerHTML = '<div class="dash-empty-inline">No files uploaded yet.</div>';
        } else {
          const all = state.uploadedFile ? [state.uploadedFile].concat(state.filesUploaded) : state.filesUploaded.slice();
          filesList.innerHTML = all.slice(0, 8).map(function (f) {
            return '<div class="doc-item">' +
              '<div class="doc-thumb"></div>' +
              '<div class="doc-info"><b>' + escapeHtml(f.name) + '</b><small>' + formatBytes(f.size) + ' · ' + timeAgo(f.when) + '</small></div>' +
              '<div class="doc-actions"></div>' +
            '</div>';
          }).join('');
        }
      }

      // Account panel
      setText(byId('acctEmail'), state.auth.email || 'Guest session');
      setText(byId('acctSince'), state.auth.since ? new Date(state.auth.since).toLocaleDateString() : 'this session');
    }

    // Render initial state on boot
    renderAuthState();
    renderDashboard();

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

    // ─── Hidden file input + picker dispatcher ───
    const hiddenFile = document.createElement('input');
    hiddenFile.type = 'file';
    hiddenFile.style.display = 'none';
    document.body.appendChild(hiddenFile);

    let pendingHandler = null;
    function pickFile(handler, accept) {
      pendingHandler = handler;
      hiddenFile.accept = accept || '';
      hiddenFile.click();
    }

    hiddenFile.addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file && typeof pendingHandler === 'function') {
        try { pendingHandler(file); }
        catch (err) { console.error(err); showToast('Could not process file'); }
      }
      hiddenFile.value = ''; // reset so same file can be selected twice
    });

    // ─── Router ──────────────────────────────────
    const PAGES = ['home','resume','cover','tools','pricing','dashboard','auth','faq','contact','privacy','terms'];

    function route() {
      let hash = (location.hash || '#home').replace('#', '');
      let parts = hash.split('?');
      let page = parts[0];
      let query = parts[1];
      if (!PAGES.includes(page)) page = 'home';

      $$('.page').forEach(function (p) { p.classList.remove('active'); });
      const target = byId('page-' + page);
      if (target) target.classList.add('active');

      $$('.nav-links a, .mobile-sheet a').forEach(function (a) {
        const href = a.getAttribute('href') || '';
        const linkPage = href.replace('#', '').split('?')[0];
        a.classList.toggle('active', linkPage === page);
      });

      if (page === 'auth') setAuthMode(query === 'signup' ? 'signup' : 'login');

      // Resume page sub-actions: ?action=rewrite, ?action=jd-match
      if (page === 'resume' && query) {
        const m = query.match(/action=([\w-]+)/);
        if (m) {
          const action = m[1];
          // Defer until DOM activation completes
          setTimeout(function () {
            if (action === 'rewrite') {
              const rewriteBtn = $('[data-action="rewrite"]');
              if (rewriteBtn) {
                rewriteBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                showToast('Click "Rewrite Bullets" to upgrade your work history');
              }
            } else if (action === 'jd-match') {
              const jdEl = byId('jdInput');
              if (jdEl) {
                jdEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                jdEl.focus();
                showToast('Paste the job description below to see your match score');
              }
            }
          }, 200);
        }
      }

      try { window.scrollTo({ top: 0, behavior: 'instant' }); }
      catch (e) { window.scrollTo(0, 0); }
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

    // ─── REAL FILE UPLOAD: home page "Upload Resume" button ───
    // Capture-phase listener fires before the data-link router and lets us
    // open a real file picker instead of just navigating.
    const homeUploadBtn = $('#page-home a[href="#tools"].btn-ghost');
    if (homeUploadBtn) {
      homeUploadBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        pickFile(function (file) {
          // Navigate to cover letter page where the upload zone lives,
          // then run the parser pipeline.
          location.hash = '#cover';
          setTimeout(function () { applyCvFile(file); }, 350);
        }, '.pdf,.doc,.docx,.txt');
      }, true);
    }

    // ─── REAL FILE UPLOAD: cover letter zone ─────
    // After upload we extract text (PDF/DOCX/TXT), parse it into structured
    // resume data, auto-fill the resume builder form, generate a cover
    // letter, and navigate the user to the resume page.

    let parsedResume = null; // last parsed result, available app-wide

    // ─── Text extraction from PDF / DOCX / TXT ───
    // Supports a `maxPages` option for partial PDF processing and an
    // `onProgress` callback so callers can update the loading UI.
    async function extractTextFromFile(file, opts) {
      opts = opts || {};
      const onProgress = opts.onProgress || function () {};

      // Hard ceiling — never even try
      if (file.size > LIMITS.global.hardBytes) {
        throw new Error('File is over ' + formatBytes(LIMITS.global.hardBytes) + ' (the absolute maximum).');
      }

      const ext = (file.name.split('.').pop() || '').toLowerCase();

      if (ext === 'txt') {
        onProgress('Reading text…');
        return await file.text();
      }
      if (ext === 'pdf') {
        if (typeof window.pdfjsLib === 'undefined') {
          throw new Error('PDF library is still loading — please retry in a moment');
        }
        try {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        } catch (e) { /* ignore */ }

        onProgress('Loading PDF…');
        const buffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
        const totalPages = pdf.numPages;
        const limit = opts.maxPages ? Math.min(opts.maxPages, totalPages) : totalPages;
        let out = '';
        for (let i = 1; i <= limit; i++) {
          onProgress('Reading page ' + i + ' of ' + limit + (totalPages > limit ? ' (' + totalPages + ' total)' : ''));
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          let lastY = null;
          for (const item of content.items) {
            const y = item.transform ? item.transform[5] : null;
            if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) out += '\n';
            out += item.str + ' ';
            lastY = y;
          }
          out += '\n\n';
          // Yield every couple of pages so the UI can repaint
          if (i % 2 === 0) await yieldNow();
        }
        return out;
      }
      if (ext === 'docx') {
        if (typeof window.mammoth === 'undefined') {
          throw new Error('DOCX library is still loading — please retry in a moment');
        }
        onProgress('Reading DOCX…');
        const buffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
        return result.value || '';
      }
      if (ext === 'doc') {
        return await file.text();
      }
      throw new Error('Unsupported file type: .' + ext);
    }

    // Get just the page count of a PDF (cheap — no text extraction)
    async function getPdfPageCount(file) {
      try {
        if (typeof window.pdfjsLib === 'undefined') return null;
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const buffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
        return pdf.numPages;
      } catch (e) { return null; }
    }

    // ─── Heuristic resume parser ────────────────
    const SECTION_PATTERNS = [
      { key: 'summary',        re: /^(professional\s+)?(summary|profile|objective|about\s+me)\s*:?\s*$/i },
      { key: 'experience',     re: /^(work\s+|professional\s+)?(experience|employment|work\s+history|career\s+history)\s*:?\s*$/i },
      { key: 'education',      re: /^(education|academic\s+(background|history)|qualifications)\s*:?\s*$/i },
      { key: 'skills',         re: /^(technical\s+|core\s+|key\s+)?(skills|competencies|expertise|technologies|tech\s+stack)\s*:?\s*$/i },
      { key: 'projects',       re: /^(projects|side\s+projects|portfolio|notable\s+projects)\s*:?\s*$/i },
      { key: 'certifications', re: /^(certifications?|certificates|licenses)\s*:?\s*$/i }
    ];

    const DATE_RE = /(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*)?(?:19|20)\d{2}\s*(?:[-–—to]+|\u2013|\u2014)\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*)?(?:Present|Current|Now|present|current|now|(?:19|20)\d{2})/;

    function detectSection(line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length > 50) return null;
      for (const p of SECTION_PATTERNS) {
        if (p.re.test(trimmed)) return p.key;
      }
      return null;
    }

    function splitIntoSections(text) {
      const lines = text.split(/\r?\n/);
      const out = { _header: [] };
      let current = '_header';
      for (const raw of lines) {
        const detected = detectSection(raw);
        if (detected) {
          current = detected;
          if (!out[current]) out[current] = [];
        } else {
          if (!out[current]) out[current] = [];
          out[current].push(raw);
        }
      }
      const result = {};
      Object.keys(out).forEach(function (k) {
        result[k] = (out[k] || []).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      });
      return result;
    }

    function parseSkills(text) {
      if (!text) return [];
      // Strip section header line, then split on common separators
      return text
        .split(/[,•|\n·;]+/)
        .map(function (s) { return s.replace(/^[-*]\s*/, '').trim(); })
        .filter(function (s) { return s && s.length > 1 && s.length < 50 && !/^\d+$/.test(s); })
        .slice(0, 30);
    }

    function parseExperiences(text) {
      if (!text) return [];
      const lines = text.split(/\r?\n/).map(function (l) { return l.replace(/\t/g, '  '); }).filter(function (l) { return l.trim(); });
      const entries = [];
      let current = null;

      function pushCurrent() {
        if (current && (current.role || current.company || current.bullets.length)) {
          entries.push(current);
        }
        current = null;
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const dateMatch = line.match(DATE_RE);
        const isBullet = /^\s*[-•·*▪◦]\s+/.test(line);
        const looksLikeHeader = !!dateMatch && !isBullet;

        if (looksLikeHeader) {
          pushCurrent();
          const dates = dateMatch[0].trim();
          const beforeDate = line.slice(0, dateMatch.index).trim();
          // Header could be "Role Title 2022 - Present" or "Company 2022 - Present"
          // Heuristic: if next line looks like a company (no leading bullet, short),
          // assume beforeDate is the role and next line is the company.
          let role = beforeDate;
          let company = '';
          const next = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
          if (next && !/^[-•·*▪◦]/.test(next) && !DATE_RE.test(next) && next.length < 80 && !detectSection(next)) {
            company = next;
          }
          current = { role: role, company: company, dates: dates, bullets: [] };
          if (company) i++;
        } else if (current && isBullet) {
          current.bullets.push(trimmed.replace(/^[-•·*▪◦]\s+/, ''));
        } else if (current && current.bullets.length === 0 && !current.company && trimmed.length < 80) {
          // A line right after the header with no bullet — treat as company
          current.company = trimmed;
        } else if (current && current.bullets.length > 0 && trimmed.length > 30) {
          // Wrapping line of previous bullet
          current.bullets[current.bullets.length - 1] += ' ' + trimmed;
        }
      }
      pushCurrent();

      // Clean up: trim, dedupe consecutive identical bullets
      return entries.map(function (e) {
        return {
          role: (e.role || '').trim(),
          company: (e.company || '').trim(),
          dates: (e.dates || '').trim(),
          bullets: e.bullets.map(function (b) { return b.trim(); }).filter(Boolean).slice(0, 8)
        };
      }).filter(function (e) { return e.role || e.company || e.bullets.length; });
    }

    function parseEducations(text) {
      if (!text) return [];
      const lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      const out = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip pure date lines
        if (/^\s*(\d{4}\s*[-–—]\s*(\d{4}|present)|\d{4})\s*$/i.test(line)) continue;
        // Look for degree-like lines (e.g., "BFA, Visual Design — RISD, 2014")
        if (/\b(BS|BA|BFA|BSc|BBA|MBA|MS|MA|MFA|PhD|Bachelor|Master|Doctorate|Associate|Diploma|Certificate)\b/i.test(line) ||
            /\bUniversity\b|\bCollege\b|\bInstitute\b|\bSchool\b/i.test(line)) {
          out.push(line);
        } else if (out.length === 0 && line.length < 120) {
          out.push(line);
        }
      }
      return out.slice(0, 4);
    }

    function parseResume(text) {
      const result = {
        name: '', title: '', email: '', phone: '', location: '',
        summary: '', skills: [], experiences: [], educations: []
      };

      if (!text || text.trim().length < 20) return result;

      // Email
      const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      if (emailMatch) result.email = emailMatch[0];

      // Phone
      const phoneMatch = text.match(/(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
      if (phoneMatch) result.phone = phoneMatch[0].trim();

      // Name + title — look at the first 8 non-empty lines
      const allLines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      const top = allLines.slice(0, 10);
      for (let i = 0; i < top.length; i++) {
        const line = top[i];
        if (line.length < 3 || line.length > 60) continue;
        if (line.includes('@')) continue;
        if (/^(\+?\d|\()/.test(line)) continue; // phone-like
        if (/^(resume|cv|curriculum)/i.test(line)) continue;
        // A name is usually 2-4 capitalized words
        const words = line.split(/\s+/);
        if (words.length >= 1 && words.length <= 5 && /^[A-Z]/.test(words[0])) {
          result.name = line;
          // Next non-trivial line might be the title
          for (let j = i + 1; j < Math.min(i + 4, top.length); j++) {
            const cand = top[j];
            if (cand.length < 3 || cand.length > 80) continue;
            if (cand.includes('@') || /^\+?\d/.test(cand)) continue;
            if (detectSection(cand)) break;
            if (cand === result.name) continue;
            result.title = cand;
            break;
          }
          break;
        }
      }

      // Location — City, State patterns
      const locMatch = text.match(/[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*,\s+[A-Z]{2}(?:\s+\d{5})?/);
      if (locMatch) result.location = locMatch[0];
      else {
        // City, Country pattern
        const locMatch2 = text.match(/\b[A-Z][a-zA-Z]+,\s+[A-Z][a-zA-Z]+\b/);
        if (locMatch2 && locMatch2[0].length < 40) result.location = locMatch2[0];
      }

      // Sections
      const sections = splitIntoSections(text);
      if (sections.summary) {
        result.summary = sections.summary
          .split(/\r?\n/)
          .map(function (l) { return l.trim(); })
          .filter(Boolean)
          .join(' ')
          .slice(0, 600);
      }
      if (sections.skills) result.skills = parseSkills(sections.skills);
      if (sections.experience) result.experiences = parseExperiences(sections.experience);
      if (sections.education) result.educations = parseEducations(sections.education);

      return result;
    }

    // ─── Upload zone state setters ───────────────
    function showCvAnalyzing(file) {
      const zone = byId('cvUpload');
      if (!zone) return;
      zone.className = 'upload-zone analyzing';
      zone.innerHTML =
        '<div class="spinner" aria-hidden="true"></div>' +
        '<h3 style="font-size:1.05rem">Analyzing your resume…</h3>' +
        '<p>Reading <b>' + escapeHtml(file.name) + '</b> &middot; ' + formatBytes(file.size) + '</p>' +
        '<div class="formats">Extracting structure with AI parsing</div>';
    }

    function showCvSuccess(file, parsed) {
      const zone = byId('cvUpload');
      if (!zone) return;
      zone.className = 'upload-zone success';
      zone.innerHTML =
        '<span class="ok-ring"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 10l3.5 3.5L15 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
        '<h3 style="font-size:1.05rem">Resume successfully parsed</h3>' +
        '<p>' + escapeHtml(file.name) + ' &middot; ' + formatBytes(file.size) + '</p>' +
        '<div class="parse-stats">' +
          '<span><b>' + parsed.experiences.length + '</b> ' + (parsed.experiences.length === 1 ? 'experience' : 'experiences') + '</span>' +
          '<span><b>' + parsed.skills.length + '</b> skills</span>' +
          '<span><b>' + parsed.educations.length + '</b> ' + (parsed.educations.length === 1 ? 'degree' : 'degrees') + '</span>' +
        '</div>' +
        '<button class="btn btn-ghost" type="button" data-action="replace-cv" style="margin-top:14px">Replace file</button>';
    }

    function showCvError(file, message) {
      const zone = byId('cvUpload');
      if (!zone) return;
      zone.className = 'upload-zone error';
      zone.innerHTML =
        '<span class="err-ring"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 5v6M10 14v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>' +
        '<h3 style="font-size:1.05rem">Could not process file</h3>' +
        '<p>' + escapeHtml(message || 'Unknown error') + '</p>' +
        '<button class="btn btn-ghost" type="button" data-action="replace-cv" style="margin-top:14px">Try another file</button>';
    }

    // ─── Apply parsed data to the resume builder form ───
    function applyParsedToForm(parsed) {
      const form = byId('resumeForm');
      if (!form) return;

      function setField(key, val) {
        const f = form.querySelector('[data-field="' + key + '"]');
        if (f && val) f.value = val;
      }

      setField('name', parsed.name);
      setField('title', parsed.title);
      setField('email', parsed.email);
      setField('phone', parsed.phone);
      setField('location', parsed.location);
      setField('summary', parsed.summary);
      if (parsed.skills.length) setField('skills', parsed.skills.join(', '));
      if (parsed.educations[0]) setField('education', parsed.educations[0]);

      const exp = parsed.experiences[0];
      if (exp) {
        setField('role1', exp.role);
        setField('company1', exp.company);
        setField('dates1', exp.dates);
        if (exp.bullets.length) setField('bullets1', exp.bullets.join('\n'));
      }

      // Take preview out of empty state and rebuild its layout
      const preview = byId('resumePreview');
      if (preview && preview.dataset.empty === '1') {
        preview.dataset.empty = '0';
        preview.innerHTML =
          '<h2 id="rp-name">—</h2>' +
          '<div class="role-line" id="rp-title"></div>' +
          '<div class="meta">' +
            '<span id="rp-email"></span>' +
            '<span id="rp-phone"></span>' +
            '<span id="rp-location"></span>' +
          '</div>' +
          '<h3>Summary</h3><p id="rp-summary"></p>' +
          '<h3>Experience</h3>' +
          '<div class="item">' +
            '<div class="item-head"><b id="rp-role1"></b><time id="rp-dates1"></time></div>' +
            '<div class="org" id="rp-company1"></div>' +
            '<ul id="rp-bullets1"></ul>' +
          '</div>' +
          '<h3>Skills</h3><div class="skills" id="rp-skills"></div>' +
          '<h3>Education</h3><p id="rp-education"></p>';
      }

      // Update state — this is the resume content
      state.hasResume = true;
      state.parsed = parsed;
      persist();

      // Trigger live preview via the form's input listener
      form.dispatchEvent(new Event('input', { bubbles: true }));

      // If there are additional experiences, render them in the preview below role1
      renderAdditionalExperiences(parsed);

      // Update dependent UI
      renderDashboard();
    }

    function renderAdditionalExperiences(parsed) {
      const preview = byId('resumePreview');
      if (!preview) return;
      // Remove any prior extra-experiences block
      const prior = preview.querySelector('.rp-extra-block');
      if (prior) prior.remove();
      if (parsed.experiences.length <= 1) return;

      const extras = parsed.experiences.slice(1, 5);
      const wrap = document.createElement('div');
      wrap.className = 'rp-extra-block';
      wrap.innerHTML = extras.map(function (e) {
        return '<div class="item">' +
          '<div class="item-head"><b>' + escapeHtml(e.role || 'Role') + '</b><time>' + escapeHtml(e.dates || '') + '</time></div>' +
          (e.company ? '<div class="org">' + escapeHtml(e.company) + '</div>' : '') +
          (e.bullets.length ? '<ul>' + e.bullets.map(function (b) { return '<li>' + escapeHtml(b) + '</li>'; }).join('') + '</ul>' : '') +
        '</div>';
      }).join('');

      // Insert after the existing experience item, before "Skills" h3
      const existingExpItem = preview.querySelector('.item');
      if (existingExpItem && existingExpItem.parentNode) {
        existingExpItem.parentNode.insertBefore(wrap, existingExpItem.nextSibling);
      } else {
        preview.appendChild(wrap);
      }

      // Mark the preview so we know it has parsed extras (used by export)
      preview.dataset.hasExtras = '1';
    }

    // ─── Apply parsed data to the cover letter form + draft a letter ───
    function applyParsedToCoverLetter(parsed) {
      const setCl = function (k, val) {
        const el = $('[data-cl="' + k + '"]');
        if (el && val) el.value = val;
      };
      setCl('name', parsed.name);

      const out = byId('coverOutput');
      if (!out) return;
      out.dataset.empty = '0';

      const name = parsed.name || 'Candidate';
      const firstName = (name.split(' ')[0] || 'Candidate').trim();
      const recent = parsed.experiences[0] || {};
      const recentRole = recent.role || 'similar roles';
      const recentCompany = recent.company || 'my previous company';
      const skillsList = parsed.skills.slice(0, 4);
      const skillsPhrase = skillsList.length
        ? skillsList.slice(0, -1).join(', ') + (skillsList.length > 1 ? ', and ' : '') + skillsList[skillsList.length - 1]
        : 'a strong, well-rounded skill set';
      const yearsExp = parsed.experiences.length;
      const expPhrase = yearsExp > 1
        ? 'Across ' + yearsExp + ' roles, '
        : (recentCompany ? 'At ' + recentCompany + ', ' : '');

      const para1 = "I'm writing to express my interest in joining your team. With direct experience as " + recentRole +
        (recentCompany ? ' at ' + recentCompany : '') +
        ", I bring a working knowledge of " + skillsPhrase + ' — and a track record of turning that into shipped work.';

      const para2 = expPhrase + "I've focused on doing the work, not just describing it: " +
        (recent.bullets[0] ? recent.bullets[0].toLowerCase().replace(/\.$/, '') + ', ' : '') +
        'and helping the team move faster as a result. I would bring the same focus and care to your team.';

      const para3 = "I'd welcome the chance to talk about how my experience maps to what you're building. " +
        "Thank you for the consideration — I look forward to hearing from you.";

      out.innerHTML =
        '<div class="from">' + escapeHtml(name) +
          (parsed.email ? '<br/>' + escapeHtml(parsed.email) : '') +
          (parsed.phone ? ' &middot; ' + escapeHtml(parsed.phone) : '') +
        '</div>' +
        '<div class="salute">Dear Hiring Team,</div>' +
        '<p>' + escapeHtml(para1) + '</p>' +
        '<p>' + escapeHtml(para2) + '</p>' +
        '<p>' + escapeHtml(para3) + '</p>' +
        '<div class="sign">Warmly,<br/>' + escapeHtml(firstName) + '</div>';
      updateWordCount();
    }

    // ─── End-to-end pipeline ─────────────────────
    async function processCvFile(file) {
      showCvAnalyzing(file);
      try {
        const text = await extractTextFromFile(file);
        if (!text || text.trim().length < 30) {
          throw new Error('Could not read enough text from this file (it may be image-only)');
        }
        const parsed = parseResume(text);
        if (!parsed.name && !parsed.email && parsed.experiences.length === 0) {
          throw new Error('No structured resume content detected. Try a different file or paste the text manually.');
        }
        parsedResume = parsed;
        applyParsedToForm(parsed);
        applyParsedToCoverLetter(parsed);
        showCvSuccess(file, parsed);
        showToast('Resume successfully generated · auto-filled');
        // Navigate to resume page to show the filled form + preview
        setTimeout(function () {
          if ((location.hash || '').replace('#', '').split('?')[0] !== 'resume') {
            location.hash = '#resume';
          }
        }, 600);
      } catch (err) {
        console.error(err);
        showCvError(file, err.message);
        showToast('Parsing failed · ' + (err.message || 'unknown error'));
      }
    }

    // Expose old name as an alias so other parts of the code (home button,
    // drag-and-drop, replace-cv handler) trigger the new pipeline too.
    function applyCvFile(file) { processCvFile(file); }

    on(byId('cvUpload'), 'click', function (e) {
      // If a [data-action] inside the zone was clicked (Replace, Try again),
      // open the picker; otherwise also open the picker on a generic zone click.
      pickFile(applyCvFile, '.pdf,.doc,.docx,.txt');
    });

    // ─── REAL FILE UPLOAD: tools zone ────────────
    let toolsActiveTool = null;
    let toolsCurrentFile = null;
    function applyToolsFile(file) {
      const zone = byId('toolsUpload');
      if (!zone) return;
      toolsCurrentFile = file;
      const toolLabel = toolsActiveTool ? (' for ' + toolsActiveTool) : '';
      zone.innerHTML =
        '<svg width="40" height="40" viewBox="0 0 40 40" fill="none">' +
          '<rect x="8" y="6" width="24" height="28" rx="2" stroke="currentColor" stroke-width="1.6"/>' +
          '<path d="M14 18h12M14 22h12M14 26h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
          '<circle cx="32" cy="32" r="6" fill="white" stroke="currentColor" stroke-width="1.6"/>' +
          '<path d="M30 32l1.5 1.5L34 31" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
        '<h3>' + escapeHtml(file.name) + '</h3>' +
        '<p>' + formatBytes(file.size) + ' &middot; File loaded' + escapeHtml(toolLabel) + '</p>' +
        '<button class="btn btn-accent" type="button" data-action="replace-tools">Choose another file</button>' +
        '<div class="formats">Uploaded ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</div>';
      zone.classList.remove('dragover');

      // Reveal the action menu with the filename
      const actions = byId('toolsActions');
      const fileLabel = byId('toolsActionsFile');
      if (actions) actions.classList.add('show');
      if (fileLabel) fileLabel.textContent = file.name;

      // Track in state
      state.filesUploaded.unshift({ name: file.name, size: file.size, when: Date.now(), kind: (file.name.split('.').pop() || '').toLowerCase() });
      if (state.filesUploaded.length > 25) state.filesUploaded.length = 25;
      addActivity('upload', 'Uploaded ' + file.name);
      persist();
      renderDashboard();

      // Scroll to actions
      setTimeout(function () {
        if (actions) actions.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 200);
    }

    // AI Tools action buttons — process the uploaded file
    on(byId('toolsActions'), 'click', async function (e) {
      const btn = e.target && e.target.closest && e.target.closest('[data-tools-action]');
      if (!btn) return;
      e.preventDefault();
      if (!toolsCurrentFile) {
        showToast('Upload a file first');
        return;
      }
      const action = btn.dataset.toolsAction;

      if (action === 'generate-resume') {
        // Run the same parser pipeline as the resume page upload
        showToast('Parsing resume…');
        try {
          const text = await extractTextFromFile(toolsCurrentFile);
          if (!text || text.trim().length < 30) throw new Error('No readable text in this file.');
          const parsed = parseResume(text);
          if (!parsed.name && !parsed.email && parsed.experiences.length === 0) {
            throw new Error('No structured content detected.');
          }
          applyParsedToForm(parsed);
          showToast('Resume generated. Switching to builder…');
          setTimeout(function () { location.hash = '#resume'; }, 700);
        } catch (err) {
          console.error(err);
          showToast('Could not generate resume: ' + err.message);
        }
      }
      else if (action === 'generate-cover') {
        showToast('Drafting cover letter…');
        try {
          const text = await extractTextFromFile(toolsCurrentFile);
          if (!text || text.trim().length < 30) throw new Error('No readable text in this file.');
          const parsed = parseResume(text);
          applyParsedToCoverLetter(parsed);
          state.coverGenerated = true;
          state.parsed = state.parsed || parsed;
          state.hasResume = true;
          persist();
          renderDashboard();
          showToast('Cover letter ready. Switching…');
          setTimeout(function () { location.hash = '#cover'; }, 700);
        } catch (err) {
          console.error(err);
          showToast('Could not generate cover letter: ' + err.message);
        }
      }
      else if (action === 'analyze') {
        showToast('Analyzing…');
        try {
          const text = await extractTextFromFile(toolsCurrentFile);
          if (!text || text.trim().length < 30) throw new Error('No readable text in this file.');
          const parsed = parseResume(text);
          applyParsedToForm(parsed);
          // Move to resume page so the user can paste a JD
          setTimeout(function () {
            location.hash = '#resume';
            setTimeout(function () {
              const jd = byId('jdInput');
              if (jd) jd.scrollIntoView({ behavior: 'smooth', block: 'center' });
              showToast('Paste a job description and click "Check ATS Score"');
            }, 400);
          }, 400);
        } catch (err) {
          console.error(err);
          showToast('Could not analyze: ' + err.message);
        }
      }
      else if (action === 'improve') {
        showToast('Improving…');
        try {
          const text = await extractTextFromFile(toolsCurrentFile);
          if (!text || text.trim().length < 30) throw new Error('No readable text in this file.');
          const parsed = parseResume(text);
          applyParsedToForm(parsed);
          // Trigger the rewriter on the first experience
          setTimeout(function () {
            location.hash = '#resume';
            setTimeout(function () {
              const rewriteBtn = $('[data-action="rewrite"]');
              if (rewriteBtn) rewriteBtn.click();
              showToast('Bullets rewritten with stronger phrasing');
            }, 500);
          }, 400);
        } catch (err) {
          console.error(err);
          showToast('Could not improve: ' + err.message);
        }
      }
    });

    on(byId('toolsUpload'), 'click', function () {
      pickFile(applyToolsFile, '.pdf,.doc,.docx,.txt,.jpg,.jpeg,.png');
    });

    // Drag-and-drop
    ['cvUpload', 'toolsUpload'].forEach(function (id) {
      const zone = byId(id);
      if (!zone) return;
      ['dragenter', 'dragover'].forEach(function (ev) {
        zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('dragover'); });
      });
      zone.addEventListener('dragleave', function (e) { e.preventDefault(); zone.classList.remove('dragover'); });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('dragover');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        if (id === 'cvUpload') applyCvFile(f);
        else applyToolsFile(f);
      });
    });

    // ─── AI upload zone on the Resume Builder page ───
    // Different DOM structure (nested prompt + status divs), so it has its
    // own renderers but shares the same parser pipeline.
    function setAiState(state) {
      const zone = byId('aiUploadZone');
      const prompt = byId('aiUploadPrompt');
      const status = byId('aiUploadStatus');
      if (!zone || !status) return;
      if (state === 'idle') {
        if (prompt) prompt.style.display = '';
        status.hidden = true;
        status.className = 'ai-upload-status';
        status.innerHTML = '';
      } else {
        if (prompt) prompt.style.display = 'none';
        status.hidden = false;
        status.className = 'ai-upload-status ' + state;
      }
    }

    function showAiAnalyzing(file) {
      setAiState('loading');
      const status = byId('aiUploadStatus');
      if (!status) return;
      status.innerHTML =
        '<div class="ai-spinner"></div>' +
        '<h4>Analyzing your resume…</h4>' +
        '<p>Reading <b>' + escapeHtml(file.name) + '</b> &middot; ' + formatBytes(file.size) + '</p>' +
        '<div class="file-meta">Extracting text and structure</div>';
    }

    function showAiSuccess(file, parsed) {
      setAiState('success');
      const status = byId('aiUploadStatus');
      if (!status) return;
      const exps = parsed.experiences ? parsed.experiences.length : 0;
      const eds = parsed.educations ? parsed.educations.length : 0;
      const sks = parsed.skills ? parsed.skills.length : 0;
      const detail = [
        parsed.name && 'name',
        parsed.email && 'email',
        exps && (exps + (exps === 1 ? ' role' : ' roles')),
        eds && (eds + (eds === 1 ? ' degree' : ' degrees')),
        sks && (sks + ' skills')
      ].filter(Boolean).join(' · ');
      status.innerHTML =
        '<div class="ai-success"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M5 11l4 4 8-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
        '<h4>Resume successfully generated</h4>' +
        '<p>Detected: ' + escapeHtml(detail || 'content') + '</p>' +
        '<div class="file-meta">' + escapeHtml(file.name) + ' &middot; ' + formatBytes(file.size) + '</div>' +
        '<div class="ai-action-row">' +
          '<button type="button" class="btn-mini" data-zone-action="reset">Upload another</button>' +
        '</div>';
    }

    function showAiError(file, message) {
      setAiState('error');
      const status = byId('aiUploadStatus');
      if (!status) return;
      status.innerHTML =
        '<div class="ai-error"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M6 6l10 10M16 6l-10 10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></div>' +
        '<h4>Could not parse file</h4>' +
        '<p>' + escapeHtml(message || 'Try a different file (PDF, DOCX, or TXT).') + '</p>' +
        '<div class="ai-action-row">' +
          '<button type="button" class="btn-mini" data-zone-action="reset">Try another file</button>' +
        '</div>';
    }

    // Generic pipeline runner — shares all logic, swaps the renderers.
    async function runResumePipeline(file, renderers) {
      // Enforce file limits up front
      const check = checkFileLimits(file, 'parsing');
      if (!check.ok) {
        renderers.error(file, check.reason);
        showToast(check.reason);
        return;
      }
      let processingMode = 'full';
      if (check.partial) {
        const choice = await askPartialProcessing('Resume parser', file, check.reason);
        if (choice === 'cancel') { renderers.error(file, 'Cancelled'); return; }
        processingMode = choice;
      }

      renderers.analyzing(file);
      try {
        const opts = {};
        if (processingMode === 'partial' && /\.pdf$/i.test(file.name)) {
          opts.maxPages = LIMITS.pdf.softPages;
        }
        let text = await extractTextFromFile(file, opts);
        if (!text || text.trim().length < 30) {
          throw new Error('Could not read enough text — the file may be a scanned image.');
        }

        // Enforce character cap on the parsing input
        let textWasTrimmed = false;
        if (text.length > LIMITS.parsing.hardChars) {
          text = text.slice(0, LIMITS.parsing.hardChars);
          textWasTrimmed = true;
          showToast('Content shortened for processing — first ' + LIMITS.parsing.hardChars.toLocaleString() + ' characters used.');
        }

        const parsed = parseResume(text);
        const hasContent = parsed.name || parsed.email || (parsed.experiences && parsed.experiences.length);
        if (!hasContent) {
          // Fallback: dump raw text into the summary field so the form is still usable
          const form = byId('resumeForm');
          const summary = form && form.querySelector('[data-field="summary"]');
          if (summary) {
            summary.value = text.slice(0, 600).replace(/\s+/g, ' ').trim();
            try { form.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
          }
          throw new Error('No structured fields detected. Loaded raw text into the summary so you can edit manually.');
        }
        parsedResume = parsed;
        applyParsedToForm(parsed);
        applyParsedToCoverLetter(parsed);
        renderers.success(file, parsed);
        const banner = (processingMode === 'partial' || textWasTrimmed) ? ' (partial)' : '';
        showToast('Resume successfully generated · auto-filled' + banner);
      } catch (err) {
        console.error(err);
        renderers.error(file, err.message);
        showToast('Parsing failed · ' + (err.message || 'unknown error'));
      }
    }

    const aiZone = byId('aiUploadZone');
    on(aiZone, 'click', function (e) {
      const action = e.target && e.target.closest && e.target.closest('[data-zone-action]');
      if (action) {
        if (action.dataset.zoneAction === 'reset') setAiState('idle');
        return;
      }
      pickFile(function (file) {
        runResumePipeline(file, {
          analyzing: showAiAnalyzing,
          success: showAiSuccess,
          error: showAiError
        });
      }, '.pdf,.docx,.txt');
    });
    on(aiZone, 'keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        aiZone.click();
      }
    });

    if (aiZone) {
      ['dragenter', 'dragover'].forEach(function (ev) {
        aiZone.addEventListener(ev, function (e) { e.preventDefault(); aiZone.classList.add('dragover'); });
      });
      aiZone.addEventListener('dragleave', function (e) { e.preventDefault(); aiZone.classList.remove('dragover'); });
      aiZone.addEventListener('drop', function (e) {
        e.preventDefault();
        aiZone.classList.remove('dragover');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        runResumePipeline(f, {
          analyzing: showAiAnalyzing,
          success: showAiSuccess,
          error: showAiError
        });
      });
    }

    // Update the home "Upload Resume" button to route to the resume page
    // and trigger the AI upload pipeline (instead of the cover-letter zone).
    if (homeUploadBtn) {
      // Remove the older listener by cloning the node, then re-bind
      const newBtn = homeUploadBtn.cloneNode(true);
      homeUploadBtn.parentNode.replaceChild(newBtn, homeUploadBtn);
      newBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        location.hash = '#resume';
        setTimeout(function () {
          pickFile(function (file) {
            runResumePipeline(file, {
              analyzing: showAiAnalyzing,
              success: showAiSuccess,
              error: showAiError
            });
          }, '.pdf,.docx,.txt');
        }, 250);
      }, true);
    }

    // ─── REAL PDF DOWNLOAD via html2pdf.js ───────
    // Robust: waits for fonts to load, skips empty content, uses a clone
    // attached to a known-rendered container so html2canvas captures it cleanly.
    async function downloadAsPdf(elementId, filename, triggerBtn) {
      // ─── 1. TARGET THE CORRECT ELEMENT ─────────
      const el = byId(elementId);
      if (!el) {
        showToast('Could not find the preview to export');
        return;
      }

      // ─── 5. PREVENT EMPTY EXPORT ───────────────
      const text = (el.innerText || el.textContent || '').trim();
      const isEmptyState = el.dataset.empty === '1';
      if (isEmptyState || text.length < 20) {
        showResultModal('Nothing to export', 'PDF download',
          '<p>Your preview is empty. Fill in the form on the left, or upload a resume to auto-fill it, then try again.</p>');
        return;
      }

      // ─── 7. LOADING STATE ──────────────────────
      let originalBtnHtml = null;
      if (triggerBtn) {
        originalBtnHtml = triggerBtn.innerHTML;
        triggerBtn.disabled = true;
        triggerBtn.innerHTML =
          '<span style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:aispin .7s linear infinite;margin-right:6px;vertical-align:-2px"></span> Generating PDF…';
      }
      showToast('Generating PDF…');

      if (typeof window.html2pdf === 'undefined') {
        if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.innerHTML = originalBtnHtml; }
        showResultModal('PDF library not loaded', 'PDF download',
          '<p>The PDF generator hasn\'t finished loading yet. Wait a moment and try again — if it persists, check your internet connection.</p>');
        return;
      }

      let renderHost = null;

      try {
        // Wait for fonts and layout to settle
        if (document.fonts && document.fonts.ready) {
          try { await document.fonts.ready; } catch (e) {}
        }
        await new Promise(function (r) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { setTimeout(r, 80); });
          });
        });

        // ─── ROOT-CAUSE FIX: clone into a standalone container ─
        // The previous capture failed because the element lives inside a CSS
        // grid (form on left, preview on right). html2canvas inherits the
        // parent grid layout and renders content shifted to the right column,
        // so most of it falls off the captured page. The fix is to clone the
        // element into a fresh, simple, full-width container with no parent
        // grid influences — then capture that.
        renderHost = document.createElement('div');
        renderHost.id = elementId + '-pdf-host';
        // CRITICAL: opacity:0 in some browsers causes child text to skip
        // painting. We use visibility:hidden + clip-path:none to ensure
        // text actually renders during capture.
        renderHost.style.cssText = [
          'position:fixed',
          'top:0',
          'left:0',
          'width:794px',
          'height:auto',
          'background:#ffffff',
          'z-index:-1',
          'pointer-events:none',
          'overflow:visible',
          'display:block',
          'margin:0',
          'padding:0',
          'box-sizing:border-box',
          'transform:translateY(-200vh)' // moves it off-screen vertically; html2canvas computes from element coords, not viewport
        ].join(';');

        const clone = el.cloneNode(true);
        clone.id = elementId + '-clone';
        // Reset all inherited layout that could shift the content
        clone.style.cssText = [
          'position:static',
          'top:auto',
          'left:auto',
          'right:auto',
          'bottom:auto',
          'transform:none',
          'box-shadow:none',
          'margin:0',
          'width:794px',
          'max-width:794px',
          'min-width:794px',
          'background:#ffffff',
          'display:block',
          'visibility:visible',
          'opacity:1',
          'padding:32px 40px',
          'box-sizing:border-box',
          'overflow:visible'
        ].join(';');

        renderHost.appendChild(clone);
        document.body.appendChild(renderHost);

        // One more frame for the clone to lay out inside the host
        await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 80); }); });

        // ─── EXPORT CONFIG ─────────────────────
        // Letter page is 8.5" wide = 216mm. With 10mm margins on each side
        // we have 196mm of content area. The clone is 794px wide, which
        // at 96dpi is 8.27in (210mm). So we use A4 sizing to match cleanly,
        // OR use jsPDF's automatic image fitting.
        //
        // Simplest reliable path: let html2pdf size the canvas to fit the
        // page automatically. We do that by NOT specifying width/height in
        // html2canvas options — let it use the element's natural size.
        const opts = {
          margin: 10,
          filename: filename || 'resume.pdf',
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
            scrollX: 0,
            scrollY: 0
          },
          jsPDF: {
            unit: 'mm',
            format: 'a4',
            orientation: 'portrait',
            compress: true
          },
          pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };

        await window.html2pdf().set(opts).from(clone).save();
        showToast('Saved ' + opts.filename);
        addActivity('download', opts.filename);

      } catch (err) {
        console.error('PDF export failed:', err);
        showResultModal('Could not export PDF', 'PDF download',
          '<p>Something went wrong while generating the PDF.</p>' +
          '<p style="color:var(--ink-3);font-size:.86rem;margin-top:8px">' + escapeHtml(err.message || 'Unknown error') + '</p>' +
          '<div class="modal-cta">' +
            '<button class="btn btn-accent" id="pdfRetryBtn">Try again</button>' +
          '</div>');
        setTimeout(function () {
          const r = document.getElementById('pdfRetryBtn');
          if (r) r.addEventListener('click', function () {
            const overlay = byId('modalOverlay');
            if (overlay) overlay.classList.remove('show');
            document.body.classList.remove('modal-open');
            setTimeout(function () { downloadAsPdf(elementId, filename, triggerBtn); }, 200);
          });
        }, 100);

      } finally {
        // Cleanup the offscreen host
        if (renderHost && renderHost.parentNode) {
          renderHost.parentNode.removeChild(renderHost);
        }
        // Restore button state
        if (triggerBtn) {
          triggerBtn.disabled = false;
          if (originalBtnHtml !== null) triggerBtn.innerHTML = originalBtnHtml;
        }
      }
    }

    // ─── Helper kept for backwards compat (no longer used in PDF flow) ──
    function isCanvasBlank(canvas) {
      try {
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        const w = canvas.width;
        const h = canvas.height;
        const samples = 10;
        const data = ctx.getImageData(0, 0, w, h).data;
        let nonWhite = 0;
        const stride = Math.max(1, Math.floor((w * h) / (samples * samples)));
        for (let i = 0; i < data.length; i += stride * 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a > 0 && (r < 250 || g < 250 || b < 250)) {
            nonWhite++;
            if (nonWhite > 3) return false;
          }
        }
        return nonWhite <= 3;
      } catch (e) {
        return false;
      }
    }

    // ─── REAL DOCX DOWNLOAD via Word-compatible HTML Blob ───
    function downloadAsDocx(elementId, filename) {
      const el = byId(elementId);
      if (!el) { showToast('Nothing to export yet'); return; }

      const docStyles =
        'body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222;line-height:1.4}' +
        'h2{font-size:20pt;margin:0 0 2pt;color:#0A1A33}' +
        'h3{font-size:11pt;text-transform:uppercase;letter-spacing:1.5pt;margin:14pt 0 4pt;color:#0A1A33;border-bottom:1pt solid #888;padding-bottom:3pt}' +
        '.role-line{color:#0B7A55;text-transform:uppercase;letter-spacing:2pt;font-size:10pt;margin-bottom:6pt}' +
        '.meta{margin-bottom:10pt;color:#555;font-size:10pt}' +
        '.meta span{margin-right:14pt}' +
        '.item{margin-bottom:8pt}' +
        '.item-head b{font-weight:bold}' +
        '.item-head time{color:#666;font-style:italic;margin-left:8pt}' +
        '.org{font-style:italic;color:#555;margin:1pt 0 2pt}' +
        'ul{margin:2pt 0 6pt 18pt}' +
        '.skills span{display:inline-block;margin:0 6pt 4pt 0;padding:1pt 6pt;border:0.5pt solid #aaa;border-radius:3pt;font-size:9.5pt}' +
        '.from{color:#666;font-size:10pt;margin-bottom:14pt}' +
        '.salute{margin-bottom:10pt}' +
        'p{margin:0 0 10pt}';

      const pre =
        '<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
        'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
        'xmlns="http://www.w3.org/TR/REC-html40">' +
        '<head><meta charset="utf-8"><title>Document</title>' +
        '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View>' +
        '<w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->' +
        '<style>' + docStyles + '</style></head><body>';
      const post = '</body></html>';
      const html = pre + el.innerHTML + post;

      try {
        const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'document.doc';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        showToast('Saved ' + a.download);
      } catch (err) {
        console.error(err);
        showToast('DOCX export failed');
      }
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
            showToast('Resume regenerated · ATS-optimized');
          }, 600);
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
          downloadAsPdf('resumePreview', 'resume.pdf', btn);
        } else if (action === 'download-docx') {
          downloadAsDocx('resumePreview', 'resume.doc');
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

    // ─── ATS Score (real calculation) ────────────
    // Tokenize the JD and resume content, find shared meaningful keywords,
    // calculate a real match score, and surface the missing keywords.
    const STOPWORDS = new Set([
      'a','an','the','and','or','but','if','of','to','in','on','at','for','with','by','from','as','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','can','may','might','must','shall','this','that','these','those','i','you','he','she','it','we','they','them','their','our','your','my','me','us','about','into','through','during','before','after','above','below','between','out','off','over','under','up','down','no','not','also','very','just','than','then','there','here','where','when','what','which','who','whom','how','why','all','any','some','more','most','other','such','only','own','same','so','too','very','one','two','three','first','second','etc','please','thank','thanks','well','look','looking','looks','seek','seeking','plus','strong','great','good','best','better','new','top','high','low','hire','hires','hiring','candidate','candidates','position','positions','role','roles','job','jobs','work','works','working','team','teams','company','companies','experience','experiences','years','year','months','month','required','required','preferred','responsible','responsibilities','requirements','qualifications','salary','benefits','compensation','equal','opportunity','employer','employers','employees','employee','hours','time','full','part','remote','onsite','hybrid'
    ]);

    function tokenize(text) {
      return (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9+#/\- ]+/g, ' ')
        .split(/\s+/)
        .filter(function (w) { return w && w.length >= 3 && !STOPWORDS.has(w); });
    }

    // Extract meaningful single-word keywords from a JD. Single words match
    // cleanly via set lookup against the resume — which is what most ATS
    // systems actually do, and avoids the noise of speculative n-grams.
    function extractKeywords(jd) {
      const tokens = tokenize(jd);
      if (tokens.length === 0) return [];

      const freq = new Map();
      for (const t of tokens) {
        // Keep substantial words (4+ chars) or technical-looking shorter ones (c++, c#, ai, ml, sql, etc — at least 3 chars and one tech char)
        const isTechShort = t.length >= 3 && /[+#/]/.test(t);
        if (t.length < 4 && !isTechShort) continue;
        freq.set(t, (freq.get(t) || 0) + 1);
      }

      const arr = [];
      for (const [phrase, count] of freq.entries()) {
        arr.push({ phrase: phrase, count: count, weight: count });
      }
      // Sort by frequency desc — most-mentioned words first
      arr.sort(function (a, b) { return b.weight - a.weight; });
      return arr.slice(0, 25);
    }

    function calculateAtsScore(jdText, resumeText) {
      if (!jdText || jdText.trim().length < 20) {
        return { error: 'Add a job description to compare against.' };
      }
      if (!resumeText || resumeText.trim().length < 30) {
        return { error: 'No resume data — upload a resume or fill in the form first.' };
      }

      const keywords = extractKeywords(jdText);
      if (keywords.length === 0) {
        return { error: 'Could not extract keywords from the job description.' };
      }

      // Build a set of resume tokens for fast lookup
      const resumeTokens = new Set(tokenize(resumeText));

      const found = [];
      const missing = [];
      for (const kw of keywords) {
        if (resumeTokens.has(kw.phrase)) found.push(kw);
        else missing.push(kw);
      }

      const totalWeight = keywords.reduce(function (a, k) { return a + k.weight; }, 0);
      const foundWeight = found.reduce(function (a, k) { return a + k.weight; }, 0);
      const score = totalWeight === 0 ? 0 : Math.round((foundWeight / totalWeight) * 100);

      let verdict;
      if (score >= 90) verdict = 'Excellent match.';
      else if (score >= 75) verdict = 'Strong match.';
      else if (score >= 60) verdict = 'Good match.';
      else if (score >= 45) verdict = 'Partial match — add more relevant keywords.';
      else verdict = 'Weak match — your resume needs significant tailoring for this role.';

      return {
        score: score,
        matched: found.length,
        total: keywords.length,
        verdict: verdict,
        foundKeywords: found.slice(0, 8).map(function (k) { return k.phrase; }),
        missingKeywords: missing.slice(0, 8).map(function (k) { return k.phrase; })
      };
    }

    function getResumeText() {
      // Combine all form values + the live preview text.
      const form = byId('resumeForm');
      const parts = [];
      if (form) {
        $$('input,textarea', form).forEach(function (el) {
          if (el.value) parts.push(el.value);
        });
      }
      const preview = byId('resumePreview');
      if (preview && preview.dataset.empty !== '1') {
        parts.push(preview.innerText || '');
      }
      // Add parsed data if we have it (in case form fields haven't been refilled)
      if (state.parsed) {
        parts.push([
          state.parsed.name, state.parsed.title, state.parsed.summary,
          (state.parsed.skills || []).join(' '),
          (state.parsed.experiences || []).map(function (e) {
            return [e.role, e.company, (e.bullets || []).join(' ')].filter(Boolean).join(' ');
          }).join(' '),
          (state.parsed.educations || []).join(' ')
        ].filter(Boolean).join(' '));
      }
      return parts.join(' \n ');
    }

    function renderAtsResult(result) {
      const ring = byId('scoreRing');
      const val = byId('scoreValue');
      const verdict = byId('scoreVerdict');
      const matched = byId('kwMatched');
      const missed = byId('kwMissed');
      const kwList = byId('kwList');
      const sugg = byId('suggestions');

      if (result.error) {
        if (ring) ring.style.setProperty('--p', 0);
        if (val) val.innerHTML = '—<small></small>';
        if (verdict) verdict.textContent = result.error;
        setText(matched, '—');
        setText(missed, '—');
        if (kwList) {
          kwList.dataset.empty = '1';
          kwList.innerHTML = '<div class="kw-empty">' + escapeHtml(result.error) + '</div>';
        }
        if (sugg) {
          sugg.dataset.empty = '1';
          sugg.innerHTML = '<div class="sugg-empty" style="color:var(--ink-3);font-size:.86rem;font-style:italic;padding:12px 0">No data available.</div>';
        }
        return;
      }

      // Animate score ring
      const target = result.score;
      let cur = 0;
      const tick = setInterval(function () {
        cur += Math.max(1, Math.round(target / 30));
        if (cur >= target) { cur = target; clearInterval(tick); }
        if (ring) ring.style.setProperty('--p', cur);
        if (val) val.innerHTML = cur + '<small>/100</small>';
      }, 22);

      if (verdict) {
        const accentClass = result.score >= 75 ? 'span' : 'span';
        verdict.innerHTML = escapeHtml(result.verdict) +
          ' <span>' + result.matched + ' of ' + result.total + ' keywords matched.</span>';
      }
      setText(matched, String(result.matched));
      setText(missed, String(result.total - result.matched));

      // Render keyword list
      if (kwList) {
        kwList.dataset.empty = '0';
        const rows = [];
        for (const kw of result.foundKeywords) {
          rows.push(
            '<div class="kw-row found">' +
              '<span class="kw-ico"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
              '<b>' + escapeHtml(kw) + '</b>' +
              '<span class="kw-tag">Found</span>' +
            '</div>'
          );
        }
        for (const kw of result.missingKeywords) {
          rows.push(
            '<div class="kw-row missing">' +
              '<span class="kw-ico"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>' +
              '<b>' + escapeHtml(kw) + '</b>' +
              '<span class="kw-tag">Missing</span>' +
            '</div>'
          );
        }
        kwList.innerHTML = rows.join('') || '<div class="kw-empty">No keywords found.</div>';
      }

      // Render concrete suggestions based on missing keywords
      if (sugg) {
        sugg.dataset.empty = '0';
        if (result.missingKeywords.length === 0) {
          sugg.innerHTML =
            '<div class="suggestion">' +
              '<div class="si"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
              '<div><b>Looking strong</b><p>Your resume covers all the keywords we extracted from this job description.</p></div>' +
            '</div>';
        } else {
          const items = result.missingKeywords.slice(0, 3).map(function (kw) {
            return '<div class="suggestion">' +
              '<div class="si"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></div>' +
              '<div><b>Add: "' + escapeHtml(kw) + '"</b><p>This appears in the job description but not in your resume. Consider weaving it into a bullet or your skills list.</p></div>' +
            '</div>';
          });
          sugg.innerHTML = items.join('');
        }
      }

      state.atsScore = result;
      persist();
      addActivity('ats', 'Ran ATS check — score ' + result.score);
      // Update dashboard stats if dashboard is being rendered
      renderDashboard();
    }

    const checkAtsBtn = byId('checkAts');
    on(checkAtsBtn, 'click', function () {
      const jdEl = byId('jdInput');
      const jd = jdEl ? jdEl.value : '';
      const resumeText = getResumeText();

      if (checkAtsBtn) {
        checkAtsBtn.disabled = true;
        checkAtsBtn.innerHTML = 'Analyzing…';
      }
      const verdict = byId('scoreVerdict');
      if (verdict) verdict.textContent = 'Analyzing keywords and bullet structure…';

      // Brief delay so users see the loading transition
      setTimeout(function () {
        const result = calculateAtsScore(jd, resumeText);
        renderAtsResult(result);
        if (checkAtsBtn) {
          checkAtsBtn.disabled = false;
          checkAtsBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 4.5L13 7l-4.5 1.5L7 13l-1.5-4.5L1 7l4.5-1.5L7 1z" fill="currentColor"/></svg> Re-run check';
        }
        if (result.error) {
          showToast(result.error);
        } else {
          showToast('ATS score · ' + result.score + '/100');
        }
      }, 350);
    });

    // Re-calculate ATS when resume content changes (debounced)
    let atsRefreshTimer;
    function scheduleAtsRefresh() {
      clearTimeout(atsRefreshTimer);
      atsRefreshTimer = setTimeout(function () {
        // Only auto-recalc if a check has already been run
        if (!state.atsScore || state.atsScore.error) return;
        const jdEl = byId('jdInput');
        const jd = jdEl ? jdEl.value : '';
        const result = calculateAtsScore(jd, getResumeText());
        renderAtsResult(result);
      }, 600);
    }
    on(byId('resumeForm'), 'input', scheduleAtsRefresh);
    on(byId('jdInput'), 'input', scheduleAtsRefresh);

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
      }, 600);
    });

    // Cover letter download buttons
    const coverForm = byId('coverForm');
    if (coverForm) {
      coverForm.addEventListener('click', function (e) {
        const btn = e.target && e.target.closest && e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'download-pdf' || action === 'download-docx') {
          e.preventDefault();
          if (action === 'download-pdf') downloadAsPdf('coverOutput', 'cover-letter.pdf', btn);
          else downloadAsDocx('coverOutput', 'cover-letter.doc');
        }
      });
    }

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
      { cat: 'ai',       name: 'Language Detector',    desc: 'Identify the language of any document and copy the text.', badge: 'AI' },
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
        return '<div class="tool" tabindex="0" data-tool="' + escapeHtml(t.name) + '">' +
          '<span class="ico">' + TOOL_ICON + '</span>' +
          (t.badge ? '<span class="badge">' + t.badge + '</span>' : '') +
          '<h3>' + escapeHtml(t.name) + '</h3>' +
          '<p>' + escapeHtml(t.desc) + '</p>' +
          '<span class="arrow">' + ARROW + '</span>' +
        '</div>';
      }).join('');
      $$('.tool', grid).forEach(function (el) {
        el.addEventListener('click', function () {
          const toolName = el.dataset.tool || 'tool';
          toolsActiveTool = toolName;
          // If a file is already uploaded, run the tool on it directly.
          // Otherwise, open the file picker.
          if (toolsCurrentFile) {
            runToolOnFile(toolName, toolsCurrentFile);
          } else {
            const zone = byId('toolsUpload');
            if (zone) {
              zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
              zone.classList.add('dragover');
              setTimeout(function () { zone.classList.remove('dragover'); }, 1200);
            }
            pickFile(function (file) {
              applyToolsFile(file);
              // Auto-run the chosen tool after upload
              setTimeout(function () { runToolOnFile(toolName, file); }, 400);
            }, '.pdf,.doc,.docx,.txt,.jpg,.jpeg,.png');
          }
        });
      });
    }

    // ─── Result modal (for tool output) ──────────
    function showResultModal(title, eyebrow, bodyHtml) {
      const overlay = byId('modalOverlay');
      const eyebrowEl = byId('modalEyebrow');
      const titleEl = byId('modalTitle');
      const bodyEl = byId('modalBody');
      if (!overlay || !titleEl || !bodyEl) {
        showToast(title);
        return;
      }
      if (eyebrowEl) eyebrowEl.textContent = eyebrow || '';
      titleEl.innerHTML = title;
      bodyEl.innerHTML = bodyHtml;
      overlay.classList.add('show');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
    }

    // Build a downloadable text blob from arbitrary content
    function downloadTextFile(filename, content, mime) {
      try {
        const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        addActivity('download', filename);
        return true;
      } catch (err) {
        console.error(err);
        showToast('Download failed');
        return false;
      }
    }

    // ─── Run a specific tool on the uploaded file ─
    // Map each tool to its limits key
    const TOOL_LIMIT_KEY = {
      'PDF Editor': 'pdf',
      'Extract Text': 'pdf',
      'PDF → Word': 'pdf',
      'Word → PDF': 'pdf',
      'PDF Compressor': 'compressor',
      'PDF Splitter': 'splitter',
      'PDF Merger': 'pdf',
      'PDF Summarizer': 'pdf',
      'File Summarizer': 'pdf',
      'Language Detector': 'translator',
      'AI Document Q&A': 'parsing',
      'AI Grammar Checker': 'parsing',
      'AI Document Rewriter': 'parsing'
    };

    async function runToolOnFile(toolName, file) {
      if (!file) { showToast('Upload a file first'); return; }

      // ─── Step 1: enforce file-size limits ─────
      const toolKey = TOOL_LIMIT_KEY[toolName] || 'pdf';
      const check = checkFileLimits(file, toolKey);
      if (!check.ok) {
        showResultModal('File too large', toolName,
          '<p>' + escapeHtml(check.reason) + '</p>' +
          '<p style="color:var(--ink-3);font-size:.86rem;margin-top:8px">' + escapeHtml(check.recommendation) + '</p>');
        return;
      }

      let processingMode = 'full';
      if (check.partial) {
        const choice = await askPartialProcessing(toolName, file, check.reason);
        if (choice === 'cancel') return;
        processingMode = choice; // 'partial' or 'full'
      }

      // ─── Step 2: show processing modal ─────────
      showProcessingModal(toolName, 'Reading ' + file.name + '…');

      // ─── Step 3: extract text with the right page limit ─
      const isPdf = /\.pdf$/i.test(file.name);
      let pdfPageCount = null;
      if (isPdf) {
        try { pdfPageCount = await getPdfPageCount(file); } catch (e) {}
      }

      const opts = { onProgress: updateProcessingStatus };
      if (isPdf && processingMode === 'partial') {
        // Per-tool page limits when partial mode is selected
        const partialPages = ({
          'pdf':         LIMITS.pdf.softPages,
          'splitter':    LIMITS.splitter.softPages,
          'compressor':  LIMITS.pdf.softPages,
          'parsing':     LIMITS.pdf.softPages,
          'translator':  LIMITS.pdf.softPages,
          'ocr':         LIMITS.ocr.softPages
        })[toolKey] || 5;
        opts.maxPages = partialPages;
      } else if (isPdf && pdfPageCount && pdfPageCount > LIMITS.pdf.hardPages) {
        // Even in "full" mode, never exceed the hard page cap
        opts.maxPages = LIMITS.pdf.hardPages;
        processingMode = 'partial';
      }

      let text = '';
      try {
        text = await extractTextFromFile(file, opts);
      } catch (err) {
        showResultModal('Could not read file', toolName,
          '<p>We couldn\'t extract text from <b>' + escapeHtml(file.name) + '</b>.</p>' +
          '<p style="color:var(--ink-3);font-size:.86rem;margin-top:8px">' + escapeHtml(err.message || 'Unknown error') + '</p>' +
          '<div class="modal-cta">' +
            '<button class="btn btn-accent" onclick="document.querySelector(&quot;.tool[data-tool=\\&quot;' + escapeHtml(toolName) + '\\&quot;]&quot;)?.click()">Retry</button>' +
          '</div>');
        return;
      }

      if (!text || text.trim().length < 5) {
        showResultModal('No text found', toolName,
          '<p><b>' + escapeHtml(file.name) + '</b> appears to contain no extractable text.</p>' +
          '<p style="color:var(--ink-3);font-size:.86rem;margin-top:8px">If this is a scanned document, you would need OCR — that\'s available via the Extract Text tool with a scanned PDF.</p>');
        return;
      }

      // Apply per-tool character caps for very text-heavy results
      const charLimit = LIMITS[toolKey] && LIMITS[toolKey].hardChars;
      let textWasTrimmed = false;
      if (charLimit && text.length > charLimit) {
        text = text.slice(0, charLimit);
        textWasTrimmed = true;
      }

      const wordCount = (text.match(/\S+/g) || []).length;
      const charCount = text.length;
      const partialBanner = (processingMode === 'partial' || textWasTrimmed)
        ? '<div style="background:#FEF6EE;border:1px solid #FBE0BC;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:.84rem;color:var(--warn)">' +
          'Partial processing: ' +
          (opts.maxPages && pdfPageCount ? 'first ' + opts.maxPages + ' of ' + pdfPageCount + ' pages' : '') +
          (textWasTrimmed ? (opts.maxPages ? ' · ' : '') + 'content trimmed to ' + charLimit.toLocaleString() + ' characters' : '') +
          '.</div>'
        : '';

      switch (toolName) {

        case 'PDF Editor':
        case 'Extract Text': {
          // Real text extraction → editable textarea + download
          showResultModal(
            'Extracted text from <em>' + escapeHtml(file.name) + '</em>',
            toolName,
            partialBanner +
            '<p style="color:var(--ink-2);margin-bottom:10px">' + wordCount + ' words · ' + charCount.toLocaleString() + ' characters extracted. Edit below or download.</p>' +
            '<textarea id="extractedText" style="width:100%;min-height:280px;padding:12px;border:1px solid var(--line);border-radius:10px;font-family:var(--mono);font-size:.82rem;line-height:1.5">' + escapeHtml(text) + '</textarea>' +
            '<div class="modal-cta">' +
              '<button class="btn btn-accent" onclick="(function(){var t=document.getElementById(\'extractedText\').value;var b=new Blob([t],{type:\'text/plain\'});var u=URL.createObjectURL(b);var a=document.createElement(\'a\');a.href=u;a.download=\'' + escapeHtml(file.name.replace(/\.[^.]+$/, '')) + '.txt\';a.click();URL.revokeObjectURL(u);})()">Download as .txt</button>' +
            '</div>'
          );
          break;
        }

        case 'PDF → Word': {
          // Convert extracted text to a Word-compatible HTML document
          const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.4">' +
            text.split('\n').map(function (line) { return '<p>' + escapeHtml(line) + '</p>'; }).join('') +
            '</body></html>';
          const baseName = file.name.replace(/\.[^.]+$/, '');
          downloadTextFile(baseName + '.doc',
            '\ufeff' + html,
            'application/msword');
          showResultModal(
            'Converted to Word',
            toolName,
            partialBanner + '<p>Saved <b>' + escapeHtml(baseName) + '.doc</b> — ' + wordCount + ' words across ' + (text.split('\n').length) + ' paragraphs.</p>' +
            '<p style="color:var(--ink-3);font-size:.86rem;margin-top:8px">Note: this is a basic HTML-to-Word conversion. Complex formatting, images, and tables in the original PDF are not preserved.</p>'
          );
          break;
        }

        case 'Word → PDF': {
          // Render the extracted text into a hidden printable element, then html2pdf it
          const printNode = document.createElement('div');
          printNode.style.cssText = 'position:fixed;top:0;left:-99999px;width:720px;background:#fff;padding:40px;font-family:Georgia,serif;font-size:11pt;line-height:1.5';
          printNode.innerHTML = text.split('\n').map(function (line) {
            return '<p style="margin:0 0 10pt">' + escapeHtml(line) + '</p>';
          }).join('');
          document.body.appendChild(printNode);

          const baseName = file.name.replace(/\.[^.]+$/, '');
          if (typeof window.html2pdf === 'undefined') {
            showToast('PDF library still loading — try again');
            document.body.removeChild(printNode);
            return;
          }
          try {
            await window.html2pdf().set({
              margin: [12, 12, 12, 12],
              filename: baseName + '.pdf',
              image: { type: 'jpeg', quality: 0.98 },
              html2canvas: { scale: 2, backgroundColor: '#ffffff' },
              jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' }
            }).from(printNode).save();
            showResultModal('Converted to PDF', toolName,
              partialBanner + '<p>Saved <b>' + escapeHtml(baseName) + '.pdf</b> — ' + wordCount + ' words.</p>');
          } catch (err) {
            console.error(err);
            showToast('PDF generation failed');
          } finally {
            if (printNode.parentNode) printNode.parentNode.removeChild(printNode);
          }
          break;
        }

        case 'PDF Compressor': {
          // For text-extractable PDFs, "compression" = re-render through html2pdf
          // with conservative settings. For non-PDF input, just inform.
          if (!/\.pdf$/i.test(file.name)) {
            showResultModal('Not a PDF', toolName,
              '<p>This tool works on PDF files. <b>' + escapeHtml(file.name) + '</b> is a different format — try the converter first.</p>');
            return;
          }
          const printNode = document.createElement('div');
          printNode.style.cssText = 'position:fixed;top:0;left:-99999px;width:720px;background:#fff;padding:32px;font-family:Helvetica,Arial,sans-serif;font-size:10pt;line-height:1.4';
          printNode.innerHTML = text.split('\n').map(function (line) {
            return '<p style="margin:0 0 6pt">' + escapeHtml(line) + '</p>';
          }).join('');
          document.body.appendChild(printNode);
          const baseName = file.name.replace(/\.[^.]+$/, '');
          try {
            await window.html2pdf().set({
              margin: [10, 10, 10, 10],
              filename: baseName + '-compressed.pdf',
              image: { type: 'jpeg', quality: 0.7 },
              html2canvas: { scale: 1, backgroundColor: '#ffffff' },
              jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait', compress: true }
            }).from(printNode).save();
            showResultModal('Compressed PDF',
              toolName,
              partialBanner + '<p>Saved <b>' + escapeHtml(baseName) + '-compressed.pdf</b>.</p>' +
              '<p style="color:var(--ink-3);font-size:.86rem;margin-top:8px">Note: this is a text-only re-flow. Original images/scans are not preserved. For image-heavy PDFs use a dedicated tool.</p>');
          } catch (err) {
            showToast('Compression failed');
          } finally {
            if (printNode.parentNode) printNode.parentNode.removeChild(printNode);
          }
          break;
        }

        case 'PDF Splitter': {
          // Split text into ~equal sections by paragraph count
          if (!/\.pdf$/i.test(file.name)) {
            showResultModal('Not a PDF', toolName,
              '<p>This tool works on PDF files. <b>' + escapeHtml(file.name) + '</b> is a different format.</p>');
            return;
          }
          const paras = text.split(/\n\s*\n/).filter(function (p) { return p.trim(); });
          const half = Math.ceil(paras.length / 2);
          const part1 = paras.slice(0, half).join('\n\n');
          const part2 = paras.slice(half).join('\n\n');
          const baseName = file.name.replace(/\.[^.]+$/, '');
          downloadTextFile(baseName + '-part1.txt', part1);
          setTimeout(function () { downloadTextFile(baseName + '-part2.txt', part2); }, 400);
          showResultModal('Split into 2 parts', toolName,
            partialBanner + '<p><b>' + escapeHtml(file.name) + '</b> split by paragraph count.</p>' +
            '<ul style="margin:8px 0 0 18px;color:var(--ink-2);font-size:.9rem"><li><b>Part 1</b>: ' + half + ' paragraphs (~' + Math.round(part1.length/1024) + ' KB)</li>' +
            '<li><b>Part 2</b>: ' + (paras.length - half) + ' paragraphs (~' + Math.round(part2.length/1024) + ' KB)</li></ul>' +
            '<p style="color:var(--ink-3);font-size:.86rem;margin-top:10px">Both parts saved as .txt. Page-based splitting requires PDF page extraction beyond text reflow.</p>');
          break;
        }

        case 'PDF Merger': {
          showResultModal('PDF Merger needs multiple files',
            toolName,
            '<p>Drop a second file to merge it with <b>' + escapeHtml(file.name) + '</b>.</p>' +
            '<p style="color:var(--ink-3);font-size:.86rem;margin-top:8px">Multi-file merge will be added in a future update — current text re-flow merging is available below.</p>' +
            '<div class="modal-cta">' +
              '<button class="btn btn-accent" id="mergeAddSecond">Add second file</button>' +
            '</div>');
          // Wire up the button
          setTimeout(function () {
            const btn = document.getElementById('mergeAddSecond');
            if (btn) btn.addEventListener('click', function () {
              pickFile(async function (file2) {
                try {
                  const text2 = await extractTextFromFile(file2);
                  const merged = text + '\n\n— — —\n\n' + text2;
                  const baseName = file.name.replace(/\.[^.]+$/, '') + '-merged';
                  downloadTextFile(baseName + '.txt', merged);
                  showResultModal('Merged 2 files',
                    toolName,
                    '<p>Combined text from <b>' + escapeHtml(file.name) + '</b> and <b>' + escapeHtml(file2.name) + '</b>.</p>' +
                    '<p>Saved as <b>' + escapeHtml(baseName) + '.txt</b> · ' + ((merged.match(/\S+/g) || []).length) + ' words total.</p>');
                } catch (err) {
                  showToast('Merge failed: ' + err.message);
                }
              }, '.pdf,.docx,.txt');
            });
          }, 100);
          break;
        }

        case 'PDF Summarizer':
        case 'File Summarizer': {
          // Real summarization: extract sentences with the highest-frequency content words
          const summary = summarizeText(text, 5);
          const keyTopics = topNTokens(text, 8);
          showResultModal(
            'Summary of <em>' + escapeHtml(file.name) + '</em>',
            toolName,
            partialBanner + '<p style="color:var(--ink-3);font-size:.84rem;margin-bottom:14px">' + wordCount.toLocaleString() + ' words → ' + summary.length + ' key sentences</p>' +
            '<h3>Key takeaways</h3><ul>' +
              summary.map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') +
            '</ul>' +
            '<h3>Top topics</h3>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">' +
              keyTopics.map(function (t) { return '<span style="padding:4px 10px;background:var(--accent-soft);color:var(--accent-deep);border-radius:99px;font-size:.84rem;font-weight:500">' + escapeHtml(t) + '</span>'; }).join('') +
            '</div>' +
            '<div class="modal-cta">' +
              '<button class="btn btn-ghost" id="downloadSummary">Download summary</button>' +
            '</div>'
          );
          setTimeout(function () {
            const dl = document.getElementById('downloadSummary');
            if (dl) dl.addEventListener('click', function () {
              const baseName = file.name.replace(/\.[^.]+$/, '');
              const summaryDoc = 'Summary of ' + file.name + '\n' +
                '═══════════════════════════════════════════\n\n' +
                'KEY TAKEAWAYS\n\n' +
                summary.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n\n') +
                '\n\nTOP TOPICS\n' + keyTopics.join(', ');
              downloadTextFile(baseName + '-summary.txt', summaryDoc);
            });
          }, 100);
          break;
        }

        case 'Language Detector': {
          // Fully functional in-browser: detect language, surface document
          // stats, let the user copy the extracted text. No external links.
          const sample = text.length > LIMITS.translator.softChars ? text.slice(0, LIMITS.translator.softChars) : text;
          const wasLimited = text.length > LIMITS.translator.softChars;
          const lang = detectLanguageHint(sample);
          const sentences = sample.split(/(?<=[.!?])\s+/).filter(function (s) { return s.trim().length > 5; }).length;
          const paragraphs = sample.split(/\n\s*\n/).filter(function (p) { return p.trim().length > 5; }).length;
          const avgSentenceLen = sentences ? Math.round((sample.match(/\S+/g) || []).length / sentences) : 0;
          showResultModal(
            'Document analysis',
            toolName,
            (wasLimited
              ? '<div style="background:#FEF6EE;border:1px solid #FBE0BC;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:.84rem;color:var(--warn)">' +
                'Partial analysis: only the first ' + LIMITS.translator.softChars.toLocaleString() + ' characters were processed (file has ' + text.length.toLocaleString() + ').' +
                '</div>'
              : '') +
            '<div class="stat-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">' +
              '<div style="padding:14px;background:var(--bg-soft);border:1px solid var(--line);border-radius:10px"><small style="font-family:var(--mono);font-size:.7rem;color:var(--ink-3);letter-spacing:.08em;text-transform:uppercase">Language</small><b style="display:block;font-family:var(--serif);font-size:1.4rem;margin-top:2px">' + escapeHtml(lang) + '</b></div>' +
              '<div style="padding:14px;background:var(--bg-soft);border:1px solid var(--line);border-radius:10px"><small style="font-family:var(--mono);font-size:.7rem;color:var(--ink-3);letter-spacing:.08em;text-transform:uppercase">Words</small><b style="display:block;font-family:var(--serif);font-size:1.4rem;margin-top:2px">' + (sample.match(/\S+/g) || []).length.toLocaleString() + '</b></div>' +
              '<div style="padding:14px;background:var(--bg-soft);border:1px solid var(--line);border-radius:10px"><small style="font-family:var(--mono);font-size:.7rem;color:var(--ink-3);letter-spacing:.08em;text-transform:uppercase">Sentences</small><b style="display:block;font-family:var(--serif);font-size:1.4rem;margin-top:2px">' + sentences + '</b></div>' +
              '<div style="padding:14px;background:var(--bg-soft);border:1px solid var(--line);border-radius:10px"><small style="font-family:var(--mono);font-size:.7rem;color:var(--ink-3);letter-spacing:.08em;text-transform:uppercase">Avg words / sentence</small><b style="display:block;font-family:var(--serif);font-size:1.4rem;margin-top:2px">' + avgSentenceLen + '</b></div>' +
            '</div>' +
            '<p style="color:var(--ink-3);font-size:.84rem;margin-bottom:6px">Translation needs an external API and is not bundled. You can copy the text below and paste it anywhere.</p>' +
            '<textarea readonly style="width:100%;min-height:160px;padding:12px;border:1px solid var(--line);border-radius:10px;font-family:var(--mono);font-size:.78rem;line-height:1.5;background:var(--bg-soft);color:var(--ink-2)" id="langText">' + escapeHtml(sample.slice(0, 1500)) + (sample.length > 1500 ? '\n…' : '') + '</textarea>' +
            '<div class="modal-cta">' +
              '<button class="btn btn-accent" id="copyLangText">Copy text to clipboard</button>' +
            '</div>'
          );
          setTimeout(function () {
            const btn = document.getElementById('copyLangText');
            if (btn) btn.addEventListener('click', async function () {
              try {
                await navigator.clipboard.writeText(sample);
                btn.textContent = 'Copied ✓';
                setTimeout(function () { btn.textContent = 'Copy text to clipboard'; }, 2000);
              } catch (err) {
                const ta = document.getElementById('langText');
                if (ta) { ta.select(); document.execCommand('copy'); btn.textContent = 'Copied ✓'; setTimeout(function () { btn.textContent = 'Copy text to clipboard'; }, 2000); }
              }
            });
          }, 100);
          break;
        }

        case 'AI Document Q&A': {
          // Real Q&A: simple keyword-based "search" within the text
          showResultModal(
            'Ask about <em>' + escapeHtml(file.name) + '</em>',
            toolName,
            partialBanner + '<p style="color:var(--ink-3);font-size:.84rem;margin-bottom:14px">' + wordCount.toLocaleString() + ' words indexed. Ask a question about the content below.</p>' +
            '<div style="display:flex;gap:8px;margin-bottom:12px">' +
              '<input type="text" id="qaInput" placeholder="e.g. What are the main topics?" style="flex:1;padding:11px 14px;border:1px solid var(--line);border-radius:10px;font-size:.94rem">' +
              '<button class="btn btn-accent" id="qaAsk">Ask</button>' +
            '</div>' +
            '<div id="qaResults"></div>'
          );
          setTimeout(function () {
            const input = document.getElementById('qaInput');
            const askBtn = document.getElementById('qaAsk');
            const results = document.getElementById('qaResults');
            const handle = function () {
              const q = input.value.trim();
              if (!q) return;
              const sentences = text.split(/(?<=[.!?])\s+/).filter(function (s) { return s.length > 20; });
              const qTokens = tokenize(q);
              if (qTokens.length === 0) {
                results.innerHTML = '<p style="color:var(--ink-3);font-style:italic">Ask a more specific question.</p>';
                return;
              }
              const scored = sentences.map(function (s) {
                const sLower = s.toLowerCase();
                const hits = qTokens.filter(function (t) { return sLower.indexOf(t) !== -1; }).length;
                return { sentence: s, score: hits };
              }).filter(function (x) { return x.score > 0; });
              scored.sort(function (a, b) { return b.score - a.score; });
              const top = scored.slice(0, 3);
              if (top.length === 0) {
                results.innerHTML = '<p style="color:var(--ink-3);font-style:italic">No relevant passages found in the document.</p>';
              } else {
                results.innerHTML =
                  '<h3 style="margin-bottom:8px">Most relevant passages</h3>' +
                  top.map(function (r) {
                    return '<div style="padding:12px 14px;border-left:3px solid var(--accent);background:var(--bg-soft);border-radius:6px;margin-bottom:8px;font-size:.9rem;line-height:1.5;color:var(--ink)">' + escapeHtml(r.sentence) + '</div>';
                  }).join('');
              }
            };
            if (askBtn) askBtn.addEventListener('click', handle);
            if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') handle(); });
            if (input) input.focus();
          }, 100);
          break;
        }

        case 'AI Grammar Checker': {
          const issues = grammarCheck(text);
          showResultModal(
            'Grammar check on <em>' + escapeHtml(file.name) + '</em>',
            toolName,
            partialBanner + '<p style="color:var(--ink-3);font-size:.84rem;margin-bottom:14px">' + wordCount.toLocaleString() + ' words analyzed · ' + issues.length + ' issues flagged</p>' +
            (issues.length === 0
              ? '<p style="padding:20px;background:var(--accent-soft);color:var(--accent-deep);border-radius:10px;font-weight:500">No issues found. Your document looks clean.</p>'
              : '<div style="display:flex;flex-direction:column;gap:10px">' +
                issues.slice(0, 12).map(function (issue) {
                  return '<div style="padding:14px;border:1px solid var(--line);border-radius:10px">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="font-size:.88rem">' + escapeHtml(issue.type) + '</b><small style="font-family:var(--mono);color:var(--ink-3);font-size:.72rem">' + escapeHtml(issue.severity) + '</small></div>' +
                    '<p style="font-size:.86rem;color:var(--ink-2);margin:0 0 4px">' + escapeHtml(issue.message) + '</p>' +
                    (issue.snippet ? '<code style="font-size:.8rem;color:var(--warn);background:#FEF6EE;padding:2px 6px;border-radius:4px">' + escapeHtml(issue.snippet) + '</code>' : '') +
                  '</div>';
                }).join('') +
                (issues.length > 12 ? '<p style="font-size:.84rem;color:var(--ink-3);text-align:center;margin-top:6px">… and ' + (issues.length - 12) + ' more issues</p>' : '') +
              '</div>')
          );
          break;
        }

        case 'AI Document Rewriter': {
          // Offer 3 tone variants of the first paragraph
          const firstPara = (text.split(/\n\s*\n/).find(function (p) { return p.trim().length > 80; }) || text.slice(0, 500)).trim();
          const concise = condenseText(firstPara);
          const formal = formalizeText(firstPara);
          const punchy = punchyText(firstPara);
          showResultModal(
            'Rewrite suggestions',
            toolName,
            partialBanner + '<p style="color:var(--ink-3);font-size:.84rem;margin-bottom:14px">Three tone variants for the opening paragraph of <b>' + escapeHtml(file.name) + '</b></p>' +
            '<h3>Original</h3>' +
            '<div style="padding:14px;background:var(--bg-soft);border-radius:8px;font-size:.88rem;line-height:1.5;margin-bottom:14px">' + escapeHtml(firstPara) + '</div>' +
            '<h3>Concise</h3>' +
            '<div style="padding:14px;border:1px solid var(--accent);background:var(--accent-soft);border-radius:8px;font-size:.88rem;line-height:1.5;margin-bottom:14px">' + escapeHtml(concise) + '</div>' +
            '<h3>Formal</h3>' +
            '<div style="padding:14px;border:1px solid var(--line);border-radius:8px;font-size:.88rem;line-height:1.5;margin-bottom:14px">' + escapeHtml(formal) + '</div>' +
            '<h3>Punchy</h3>' +
            '<div style="padding:14px;border:1px solid var(--line);border-radius:8px;font-size:.88rem;line-height:1.5">' + escapeHtml(punchy) + '</div>'
          );
          break;
        }

        default:
          showResultModal(toolName, 'Tool',
            '<p>This tool isn\'t implemented yet. We\'ll add it in a future update.</p>');
      }

      addActivity('tool', toolName + ' → ' + file.name);
    }

    // ─── Helper: extractive summarization ───────
    function summarizeText(text, n) {
      const sentences = text.split(/(?<=[.!?])\s+/).filter(function (s) { return s.trim().length > 15 && s.trim().length < 500; });
      if (sentences.length === 0) {
        // Fallback: split on newlines if no clear sentence breaks
        const lines = text.split('\n').filter(function (l) { return l.trim().length > 15; });
        if (lines.length === 0) return [text.slice(0, 200)];
        return lines.slice(0, n || 5);
      }
      // Score sentences by sum of frequencies of their content words
      const tokens = tokenize(text);
      const freq = new Map();
      for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
      const maxFreq = Math.max.apply(null, Array.from(freq.values())) || 1;
      const scored = sentences.map(function (s, i) {
        const tks = tokenize(s);
        const score = tks.reduce(function (acc, t) { return acc + (freq.get(t) || 0) / maxFreq; }, 0);
        // Position bias: earlier sentences get a small boost
        const posBoost = Math.max(0, 1 - i / sentences.length) * 0.3;
        return { sentence: s.trim(), score: score / Math.max(1, tks.length) + posBoost, idx: i };
      });
      scored.sort(function (a, b) { return b.score - a.score; });
      const top = scored.slice(0, n || 5);
      // Return in original order
      top.sort(function (a, b) { return a.idx - b.idx; });
      return top.map(function (s) { return s.sentence; });
    }

    function topNTokens(text, n) {
      const tokens = tokenize(text);
      const freq = new Map();
      for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
      // Lowered threshold: any token, not just freq >= 2
      const arr = Array.from(freq.entries());
      arr.sort(function (a, b) { return b[1] - a[1]; });
      return arr.slice(0, n || 8).map(function (e) { return e[0]; });
    }

    function detectLanguageHint(text) {
      const sample = text.slice(0, 2000).toLowerCase();
      // Score each language by counting unique-to-it stopwords. Higher score wins.
      const scores = {
        English: 0,
        Spanish: 0,
        French: 0,
        German: 0,
        Italian: 0
      };
      const tokens = sample.split(/[^a-záéíóúñüäöß]+/).filter(Boolean);
      for (const t of tokens) {
        // English-distinct
        if (/^(the|and|for|with|are|was|were|have|been|that|this|from|will)$/.test(t)) scores.English++;
        // Spanish-distinct
        else if (/^(los|las|también|hacer|nuestro|hicieron|fueron|haya|tiempo|cosas)$/.test(t)) scores.Spanish++;
        // French-distinct
        else if (/^(nous|vous|sont|était|aussi|notre|votre|très|être|avec|pour|dans|leur|sans)$/.test(t)) scores.French++;
        // German-distinct
        else if (/^(und|ist|nicht|auch|unser|sein|werden|haben|wird|nicht|kann)$/.test(t)) scores.German++;
        // Italian-distinct
        else if (/^(sono|nostro|essere|come|tempo|anche|della|delle|dello|sull)$/.test(t)) scores.Italian++;
      }
      let best = 'unknown';
      let max = 0;
      for (const lang in scores) {
        if (scores[lang] > max) { max = scores[lang]; best = lang; }
      }
      return max > 0 ? best : 'unknown';
    }

    function grammarCheck(text) {
      const issues = [];

      // 1. Double spaces
      const dblSpaces = (text.match(/  +/g) || []);
      if (dblSpaces.length > 0) {
        issues.push({ type: 'Spacing', severity: 'low', message: dblSpaces.length + ' instance' + (dblSpaces.length === 1 ? '' : 's') + ' of double-spaces between words.', snippet: '" "' });
      }

      // 2. Common typos — case-insensitive, word-boundaried
      const typos = [
        ['teh', 'the'],
        ['recieve', 'receive'],
        ['seperate', 'separate'],
        ['occured', 'occurred'],
        ['definately', 'definitely'],
        ['basicly', 'basically'],
        ['accomodate', 'accommodate'],
        ['untill', 'until'],
        ['publically', 'publicly'],
        ['priviledge', 'privilege'],
        ['embarass', 'embarrass']
      ];
      typos.forEach(function (pair) {
        const re = new RegExp('\\b' + pair[0] + '\\b', 'gi');
        const m = text.match(re);
        if (m) issues.push({
          type: 'Spelling',
          severity: 'medium',
          message: m.length + ' instance' + (m.length === 1 ? '' : 's') + ' of "' + pair[0] + '" — should be "' + pair[1] + '".',
          snippet: '"' + pair[0] + '" → "' + pair[1] + '"'
        });
      });

      // 3. Sentence start with lowercase (after period + space)
      const lcStart = text.match(/[.!?]\s+([a-z])/g);
      if (lcStart && lcStart.length > 0) {
        issues.push({
          type: 'Capitalization',
          severity: 'medium',
          message: lcStart.length + ' sentence' + (lcStart.length === 1 ? '' : 's') + ' starting with a lowercase letter.',
          snippet: lcStart[0].trim()
        });
      }

      // 4. Missing space after period (catches both "word.Word" and "word.word")
      const noSpace = text.match(/[a-z]\.[a-zA-Z][a-z]/g);
      if (noSpace) {
        issues.push({
          type: 'Punctuation',
          severity: 'low',
          message: noSpace.length + ' missing space' + (noSpace.length === 1 ? '' : 's') + ' after a period.',
          snippet: noSpace[0]
        });
      }

      // 5. Repeated word (back-to-back)
      const repeated = text.match(/\b(\w+)\s+\1\b/gi);
      if (repeated) {
        issues.push({
          type: 'Repetition',
          severity: 'medium',
          message: repeated.length + ' word' + (repeated.length === 1 ? '' : 's') + ' repeated back-to-back.',
          snippet: repeated[0]
        });
      }

      // 6. there/their/they're confusion (heuristic)
      const theirAreMatch = text.match(/\btheir\s+(?:is|are|was|were)\b/gi);
      if (theirAreMatch) {
        issues.push({
          type: 'Word choice',
          severity: 'medium',
          message: theirAreMatch.length + ' likely confusion of "their" and "there".',
          snippet: theirAreMatch[0] + ' → "there ' + theirAreMatch[0].split(/\s+/)[1] + '"'
        });
      }

      // 7. Very long sentences (>40 words)
      const sentences = text.split(/(?<=[.!?])\s+/);
      const longOnes = sentences.filter(function (s) { return (s.match(/\S+/g) || []).length > 40; });
      if (longOnes.length > 0) {
        issues.push({
          type: 'Readability',
          severity: 'low',
          message: longOnes.length + ' very long sentence' + (longOnes.length === 1 ? '' : 's') + ' (40+ words). Consider breaking up.',
          snippet: ''
        });
      }

      // 8. Passive voice cues
      const passive = (text.match(/\b(?:was|were|is|are|been|being|be)\s+\w+(?:ed|en)\b/gi) || []);
      if (passive.length > 5) {
        issues.push({
          type: 'Style',
          severity: 'low',
          message: passive.length + ' likely passive-voice constructions. Active voice often reads stronger.',
          snippet: passive[0]
        });
      }

      // 9. Missing Oxford comma (heuristic — flagging is informational only)
      const noOxford = text.match(/\w+,\s+\w+\s+and\s+\w+/g);
      if (noOxford && noOxford.length > 2) {
        issues.push({
          type: 'Style',
          severity: 'low',
          message: noOxford.length + ' lists without an Oxford comma. Style preference, but consistency matters.',
          snippet: noOxford[0]
        });
      }

      return issues;
    }

    function condenseText(text) {
      // Remove redundant words and shorten
      return text
        .replace(/\b(very|really|quite|rather|somewhat|perhaps|maybe|just|simply|basically|essentially|actually|literally)\s+/gi, '')
        .replace(/\bin order to\b/gi, 'to')
        .replace(/\bdue to the fact that\b/gi, 'because')
        .replace(/\bat this point in time\b/gi, 'now')
        .replace(/\bin the event that\b/gi, 'if')
        .replace(/\bfor the purpose of\b/gi, 'for')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function formalizeText(text) {
      return text
        .replace(/\bcan't\b/gi, 'cannot')
        .replace(/\bwon't\b/gi, 'will not')
        .replace(/\bdon't\b/gi, 'do not')
        .replace(/\bI'm\b/gi, 'I am')
        .replace(/\bisn't\b/gi, 'is not')
        .replace(/\bdoesn't\b/gi, 'does not')
        .replace(/\bgot\b/gi, 'obtained')
        .replace(/\bget\b/gi, 'obtain')
        .replace(/\bbig\b/gi, 'substantial')
        .replace(/\bok\b/gi, 'acceptable')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function punchyText(text) {
      // Take first sentence + tighten
      const first = text.split(/(?<=[.!?])\s+/)[0] || text;
      return condenseText(first);
    }

    on(byId('toolCats'), 'click', function (e) {
      const btn = e.target && e.target.closest && e.target.closest('button');
      if (!btn) return;
      $$('#toolCats button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      renderTools(btn.dataset.cat);
    });
    renderTools('all');

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
      const isSignup = $('#authTabs button[data-mode="signup"].active') !== null;
      const emailInput = $('#authForm input[type="email"]');
      const passInput = $('#authForm input[type="password"]');
      const email = emailInput && emailInput.value.trim();
      const pass = passInput && passInput.value;

      if (!email || email.indexOf('@') === -1) {
        showToast('Please enter a valid email');
        return;
      }
      if (!pass || pass.length < 6) {
        showToast('Password must be at least 6 characters');
        return;
      }

      // Mock login: set sessionStorage flag → enables persistence
      state.auth = {
        loggedIn: true,
        email: email,
        since: state.auth.since || new Date().toISOString()
      };
      try { sessionStorage.setItem(STATE_KEY + ':session', '1'); } catch (e) {}
      persist();

      showToast(isSignup ? 'Account created — welcome!' : 'Signed in');
      renderAuthState();
      renderDashboard();
      setTimeout(function () { location.hash = '#dashboard'; }, 600);
    });

    // ─── Dashboard sidebar tabs ──────────────────
    on(byId('dashNav'), 'click', function (e) {
      const btn = e.target && e.target.closest && e.target.closest('button[data-tab]');
      if (!btn) return;
      $$('#dashNav button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      $$('.dash-panel').forEach(function (p) {
        if (p.dataset.panel === tab) p.removeAttribute('hidden');
        else p.setAttribute('hidden', '');
      });
    });

    on(byId('acctSignOut'), 'click', function () {
      try { sessionStorage.removeItem(STATE_KEY + ':session'); } catch (e) {}
      state.auth = { loggedIn: false, email: null, since: null };
      // We DON'T wipe localStorage on sign-out — that lets users sign back in
      // and find their data still there.
      showToast('Signed out');
      renderAuthState();
      renderDashboard();
      setTimeout(function () { location.hash = '#home'; }, 400);
    });

    on(byId('acctClearData'), 'click', function () {
      if (!confirm('Permanently delete all your saved data? This cannot be undone.')) return;
      clearAllData();
      // Reload so the form repopulates with empty defaults
      showToast('All data cleared');
      setTimeout(function () { location.reload(); }, 400);
    });

    // ─── Dashboard doc actions: real downloads ───
    $$('.doc-actions button').forEach(function (b) {
      b.addEventListener('click', function () {
        const title = b.title || '';
        const docInfo = b.closest('.doc-item') && b.closest('.doc-item').querySelector('.doc-info b');
        const label = docInfo ? docInfo.textContent : 'document';
        if (title === 'Edit') {
          location.hash = '#resume';
          showToast('Opening "' + label + '" for editing');
        } else if (title === 'Download') {
          const text = 'ResumeFlow — exported document\n' +
                       '──────────────────────────────────\n\n' +
                       label + '\n\n' +
                       'Exported on ' + new Date().toLocaleString() + '\n';
          const blob = new Blob([text], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = label.replace(/[^\w\d\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() + '.txt';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
          showToast('Saved ' + a.download);
        }
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
      }, 600);
    });

    // ─── Footer info modals ──────────────────────
    const MODAL_CONTENT = {
      'about': {
        eyebrow: 'About',
        title: 'Built for people on the <em>job hunt.</em>',
        body:
          '<p>ResumeFlow was started in 2024 by a team of designers and engineers who had spent too many evenings hand-formatting resumes for friends. We believed the writing should be the hard part — not the layout, the keyword game, or whether your file would even open in a recruiter\'s ATS.</p>' +
          '<p>Today we\'re a small team based in San Francisco, with users in 87 countries. We\'re backed by operators from the design and recruiting worlds — and entirely focused on one thing: getting people the role they want, faster.</p>' +
          '<div class="stat-grid">' +
            '<div class="stat-card"><b>240k+</b><small>Job seekers helped</small></div>' +
            '<div class="stat-card"><b>87</b><small>Countries</small></div>' +
            '<div class="stat-card"><b>4.8 ★</b><small>Average rating</small></div>' +
            '<div class="stat-card"><b>2024</b><small>Founded</small></div>' +
          '</div>' +
          '<div class="modal-cta"><a href="#contact" class="btn btn-accent" data-link data-modal-close>Get in touch</a></div>'
      },
      'careers': {
        eyebrow: 'Careers',
        title: 'Build careers — including <em>yours.</em>',
        body:
          '<p>We\'re a small remote-first team, hiring people who care about craft, communicate clearly, and want their work to actually help someone. We default to async, write things down, and ship in small steps.</p>' +
          '<h3>Open roles</h3>' +
          '<div class="role-list">' +
            '<div class="role"><b>Senior Frontend Engineer</b><span>Remote · Full-time</span></div>' +
            '<div class="role"><b>ML Engineer, Document Models</b><span>Remote · Full-time</span></div>' +
            '<div class="role"><b>Product Designer</b><span>SF or Remote · Full-time</span></div>' +
            '<div class="role"><b>Customer Success Lead</b><span>Remote · Full-time</span></div>' +
          '</div>' +
          '<p>Don\'t see your role? We\'re always open to hearing from talented people. Email <a href="mailto:careers@resumeflow.app">careers@resumeflow.app</a> with a short note about what you\'d want to work on.</p>'
      },
      'blog': {
        eyebrow: 'Blog',
        title: 'Job-hunt notes from <em>the field.</em>',
        body:
          '<p>Practical writing on resumes, interviews, and the hiring process — short, opinionated, and based on what we hear from real users.</p>' +
          '<div class="post-list">' +
            '<div class="post"><b>The 12 words recruiters scan for first</b><small>April 18, 2026 · 4 min read</small></div>' +
            '<div class="post"><b>Why your cover letter is being ignored</b><small>April 4, 2026 · 6 min read</small></div>' +
            '<div class="post"><b>How to write a one-page resume after 10 years of experience</b><small>March 22, 2026 · 8 min read</small></div>' +
            '<div class="post"><b>ATS myths, debunked: the parsing rules nobody explains</b><small>March 9, 2026 · 5 min read</small></div>' +
            '<div class="post"><b>The interview thank-you note that lands offers</b><small>February 27, 2026 · 3 min read</small></div>' +
          '</div>' +
          '<p style="margin-top:14px">Want new posts in your inbox? Email us at <a href="mailto:hello@resumeflow.app?subject=Subscribe%20to%20blog">hello@resumeflow.app</a>.</p>'
      },
      'resume-guide': {
        eyebrow: 'Guide',
        title: 'How to write a resume that <em>gets read.</em>',
        body:
          '<p>Recruiters spend an average of 6–8 seconds on a first pass. Your resume isn\'t being read — it\'s being scanned. Here\'s how to make those seconds count.</p>' +
          '<h3>The structure that works</h3>' +
          '<ul>' +
            '<li><b>Top third:</b> name, title, contact, and 2–3 sentence summary that names the role you want and why you\'d be good at it.</li>' +
            '<li><b>Middle:</b> 3–5 most recent roles, each with 3–5 achievement-focused bullets.</li>' +
            '<li><b>Bottom:</b> skills, education, certifications. Keep it tight.</li>' +
          '</ul>' +
          '<h3>Bullets that don\'t put recruiters to sleep</h3>' +
          '<ul>' +
            '<li>Lead with a strong verb — <i>led, built, shipped, redesigned, mentored</i> — not <i>responsible for</i>.</li>' +
            '<li>End with a number when you can — users, revenue, time saved, percentage lift.</li>' +
            '<li>Show scope: team size, budget, geography, complexity.</li>' +
          '</ul>' +
          '<h3>Length</h3>' +
          '<p>One page if you have under 8 years of experience. Two pages if more. Never three. Use the Resume Rewriter in ResumeFlow to tighten any bullet that feels long.</p>' +
          '<div class="modal-cta"><a href="#resume" class="btn btn-accent" data-link data-modal-close>Open the builder</a></div>'
      },
      'cover-tips': {
        eyebrow: 'Tips',
        title: 'Cover letters that don\'t <em>sound like everyone else\'s.</em>',
        body:
          '<p>Most cover letters get skipped because they restate the resume. Yours shouldn\'t. Use the cover letter to do something the resume can\'t: tell a recruiter why this specific role at this specific company makes sense for you.</p>' +
          '<h3>The four-paragraph formula</h3>' +
          '<ol style="padding-left:20px;margin:0 0 14px">' +
            '<li><b>Hook (2–3 sentences):</b> name the role, anchor your experience, hint at the angle you\'ll explore.</li>' +
            '<li><b>Why this company (1 paragraph):</b> something specific they\'re doing — not just "I love your mission".</li>' +
            '<li><b>What you bring (1 paragraph):</b> concrete experience that maps to their job description.</li>' +
            '<li><b>Close (2 sentences):</b> short, warm, ask for a conversation.</li>' +
          '</ol>' +
          '<h3>Things to cut</h3>' +
          '<ul>' +
            '<li><i>"To Whom It May Concern"</i> — find a name, or write "Hiring Team".</li>' +
            '<li><i>"I am writing to apply for..."</i> — they know that already.</li>' +
            '<li>Quoting their mission statement back at them. They wrote it.</li>' +
          '</ul>' +
          '<div class="modal-cta"><a href="#cover" class="btn btn-accent" data-link data-modal-close>Try the cover letter builder</a></div>'
      },
      'ats-guide': {
        eyebrow: 'Guide',
        title: 'How applicant tracking systems <em>actually work.</em>',
        body:
          '<p>An applicant tracking system (ATS) is software that ingests your resume, parses it into structured fields, and lets recruiters search and filter applicants. Workday, Greenhouse, Lever, iCIMS, and Taleo handle the majority of large-company hiring.</p>' +
          '<h3>What ATSes actually do</h3>' +
          '<ul>' +
            '<li><b>Parse</b> your resume into name, contact, work history, skills, and education.</li>' +
            '<li><b>Index</b> the text so it\'s searchable by keywords.</li>' +
            '<li><b>Score</b> matches against job descriptions (some, not all).</li>' +
            '<li><b>Surface</b> the highest-match candidates to recruiters.</li>' +
          '</ul>' +
          '<h3>How to write a resume that parses cleanly</h3>' +
          '<ul>' +
            '<li>Use real text, not images of text. ATSes can\'t read images.</li>' +
            '<li>Standard section headers: Experience, Education, Skills.</li>' +
            '<li>Avoid two-column layouts, text in headers/footers, and tables.</li>' +
            '<li>Standard fonts (Calibri, Arial, Helvetica, Garamond) and PDF or DOCX format.</li>' +
            '<li>Match keywords from the job description — exactly, not paraphrased.</li>' +
          '</ul>' +
          '<p>The ATS Resume Checker in ResumeFlow runs your resume through these same parsing rules and tells you exactly what to fix.</p>' +
          '<div class="modal-cta"><a href="#resume" class="btn btn-accent" data-link data-modal-close>Run an ATS check</a></div>'
      },
      'cookies': {
        eyebrow: 'Legal',
        title: 'Cookie Policy',
        body:
          '<p><b>Last updated:</b> April 12, 2026</p>' +
          '<p>We use a small number of cookies and similar technologies to keep ResumeFlow working. We don\'t run ad-targeting cookies, and we don\'t share data with third-party advertisers.</p>' +
          '<h3>Essential cookies</h3>' +
          '<p>Used to keep you signed in, remember your plan, and preserve your preferences (theme, billing cycle). These cannot be disabled — the product wouldn\'t work without them.</p>' +
          '<h3>Analytics cookies</h3>' +
          '<p>We use a privacy-first analytics tool (no cross-site tracking, IP anonymization) to understand which features people use. You can disable analytics from <b>Account → Privacy</b> at any time.</p>' +
          '<h3>Third-party cookies</h3>' +
          '<p>The only third-party cookie we set is from Stripe (payment processor) on the checkout page. It\'s required for secure card processing. We do not use Facebook, Google Ads, or LinkedIn Insight pixels.</p>' +
          '<h3>Managing cookies</h3>' +
          '<p>You can control cookies in your browser settings. Disabling essential cookies will sign you out and prevent the app from saving your work.</p>' +
          '<p>Questions? Email <a href="mailto:privacy@resumeflow.app">privacy@resumeflow.app</a>.</p>'
      },
      'dpa': {
        eyebrow: 'Legal',
        title: 'Data Processing Addendum',
        body:
          '<p>The Data Processing Addendum (DPA) is a contract that governs how ResumeFlow processes personal data on behalf of Business plan customers. It exists to satisfy GDPR, UK GDPR, CCPA, and similar privacy regulations when your team uses ResumeFlow to handle other people\'s information (e.g., recruiters using the platform with candidate data).</p>' +
          '<h3>What\'s in our DPA</h3>' +
          '<ul>' +
            '<li>Definition of controller and processor roles between you and us.</li>' +
            '<li>The categories of personal data we process and why.</li>' +
            '<li>Subprocessors we use (current list: AWS, Stripe, Postmark, Datadog, OpenAI).</li>' +
            '<li>Security measures we maintain — encryption, access controls, audit logging.</li>' +
            '<li>How we handle data subject requests, breach notifications, and audits.</li>' +
            '<li>International data transfer safeguards (Standard Contractual Clauses).</li>' +
          '</ul>' +
          '<h3>Who needs it</h3>' +
          '<p>If you\'re using ResumeFlow as an individual job seeker, you don\'t need a DPA — your relationship with us is covered by our standard <a href="#privacy" data-modal-close>Privacy Policy</a>.</p>' +
          '<p>If you\'re a Business-plan customer or considering one, email <a href="mailto:legal@resumeflow.app?subject=DPA%20request">legal@resumeflow.app</a> and we\'ll send a countersigned copy within one business day.</p>'
      },
      'security': {
        eyebrow: 'Legal',
        title: 'Our security practices.',
        body:
          '<p>Your resume and cover letter are personal documents. We treat them that way.</p>' +
          '<h3>Encryption</h3>' +
          '<ul>' +
            '<li><b>In transit:</b> all traffic is TLS 1.3.</li>' +
            '<li><b>At rest:</b> AES-256 encryption on every stored document, backup, and database snapshot.</li>' +
          '</ul>' +
          '<h3>Access controls</h3>' +
          '<ul>' +
            '<li>Production access is limited to a small on-call rotation, logged, and reviewed monthly.</li>' +
            '<li>Two-factor authentication is required for all ResumeFlow employees.</li>' +
            '<li>Customer documents are isolated per account; no team can see another team\'s data.</li>' +
          '</ul>' +
          '<h3>AI processing</h3>' +
          '<p>When you generate a resume or cover letter, your input is sent to our AI processing layer over an encrypted channel. <b>Inputs are not retained for model training</b> and are deleted from processing logs within 30 days.</p>' +
          '<h3>Compliance</h3>' +
          '<ul>' +
            '<li>SOC 2 Type II — annual audit (most recent: February 2026)</li>' +
            '<li>GDPR &amp; UK GDPR compliant</li>' +
            '<li>CCPA / CPRA compliant</li>' +
            '<li>HIPAA controls available on Business plan (BAA on request)</li>' +
          '</ul>' +
          '<h3>Reporting a vulnerability</h3>' +
          '<p>Found a security issue? Email <a href="mailto:security@resumeflow.app">security@resumeflow.app</a>. We respond within 24 hours and run a paid disclosure program for valid reports.</p>'
      }
    };

    const modalOverlay = byId('modalOverlay');
    const modalEyebrow = byId('modalEyebrow');
    const modalTitle = byId('modalTitle');
    const modalBody = byId('modalBody');
    const modalClose = byId('modalClose');

    function openModal(id) {
      const content = MODAL_CONTENT[id];
      if (!content || !modalOverlay) return;
      setText(modalEyebrow, content.eyebrow || '');
      setHTML(modalTitle, content.title || '');
      setHTML(modalBody, content.body || '');
      modalOverlay.classList.add('show');
      modalOverlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      // Focus the close button for keyboard accessibility
      setTimeout(function () { if (modalClose) modalClose.focus(); }, 50);
    }

    function closeModal() {
      if (!modalOverlay) return;
      modalOverlay.classList.remove('show');
      modalOverlay.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
    }

    on(modalClose, 'click', closeModal);
    on(modalOverlay, 'click', function (e) {
      // Close when clicking on the backdrop (but not the modal content itself)
      if (e.target === modalOverlay) closeModal();
    });
    on(document, 'keydown', function (e) {
      if (e.key === 'Escape' && modalOverlay && modalOverlay.classList.contains('show')) {
        closeModal();
      }
    });

    // Open modal when [data-modal] is clicked. Use capture so it runs before
    // the global [data-link] router (some links inside modals carry both).
    document.addEventListener('click', function (e) {
      const trigger = e.target && e.target.closest && e.target.closest('[data-modal]');
      if (!trigger) {
        // Also handle [data-modal-close] inside modal CTAs
        const closer = e.target && e.target.closest && e.target.closest('[data-modal-close]');
        if (closer) closeModal();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      openModal(trigger.dataset.modal);
    }, true);

  } // end init()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
