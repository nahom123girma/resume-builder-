/* CareerForge AI — frontend logic
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
          showToast('Resume uploaded: ' + file.name + ' (' + formatBytes(file.size) + ')');
          location.hash = '#cover';
          setTimeout(function () { applyCvFile(file); }, 350);
        }, '.pdf,.doc,.docx,.txt');
      }, true);
    }

    // ─── REAL FILE UPLOAD: cover letter zone ─────
    function applyCvFile(file) {
      const zone = byId('cvUpload');
      if (!zone) return;
      zone.innerHTML =
        '<svg width="28" height="28" viewBox="0 0 28 28" fill="none">' +
          '<circle cx="14" cy="14" r="12" stroke="currentColor" stroke-width="1.6"/>' +
          '<path d="M9 14l3.5 3.5L19 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>' +
        '<h3 style="font-size:1.05rem">' + escapeHtml(file.name) + '</h3>' +
        '<p>' + formatBytes(file.size) + ' &middot; Ready to use as reference</p>' +
        '<button class="btn btn-ghost" type="button" data-action="replace-cv">Replace file</button>' +
        '<div class="formats">Uploaded ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</div>';
      zone.classList.remove('dragover');
      zone.dataset.fileLoaded = '1';

      // For .txt files we can read content as a helpful confirmation.
      if (/\.txt$/i.test(file.name)) {
        const reader = new FileReader();
        reader.onload = function (ev) {
          const txt = (ev.target.result || '').toString();
          showToast('Read ' + file.name + ' (' + txt.length.toLocaleString() + ' chars)');
        };
        reader.onerror = function () { showToast('Could not read file contents'); };
        reader.readAsText(file);
      }
    }

    on(byId('cvUpload'), 'click', function () {
      pickFile(applyCvFile, '.pdf,.doc,.docx,.txt');
    });

    // ─── REAL FILE UPLOAD: tools zone ────────────
    let toolsActiveTool = null;
    function applyToolsFile(file) {
      const zone = byId('toolsUpload');
      if (!zone) return;
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
    }

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

    // ─── REAL PDF DOWNLOAD via html2pdf.js ───────
    function downloadAsPdf(elementId, filename) {
      const el = byId(elementId);
      if (!el) { showToast('Nothing to export yet'); return; }
      if (typeof window.html2pdf === 'undefined') {
        showToast('PDF library still loading — try again in a moment');
        return;
      }
      showToast('Generating PDF…');
      const opts = {
        margin: [10, 12, 10, 12],
        filename: filename || 'document.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
        jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      };
      window.html2pdf().set(opts).from(el).save()
        .then(function () { showToast('Saved ' + opts.filename); })
        .catch(function (err) { console.error(err); showToast('PDF export failed'); });
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
          downloadAsPdf('resumePreview', 'resume.pdf');
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
          if (action === 'download-pdf') downloadAsPdf('coverOutput', 'cover-letter.pdf');
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
          toolsActiveTool = el.dataset.tool || 'tool';
          const zone = byId('toolsUpload');
          if (zone) {
            zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
            zone.classList.add('dragover');
            setTimeout(function () { zone.classList.remove('dragover'); }, 1200);
          }
          pickFile(applyToolsFile, '.pdf,.doc,.docx,.txt,.jpg,.jpeg,.png');
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
      showToast(isSignup ? 'Account created — welcome!' : 'Signed in');
      setTimeout(function () { location.hash = '#dashboard'; }, 600);
    });

    // ─── Dashboard nav ───────────────────────────
    $$('.dash-nav button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.dash-nav button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      });
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
          const text = 'CareerForge AI — exported document\n' +
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
          '<p>CareerForge AI was started in 2024 by a team of designers and engineers who had spent too many evenings hand-formatting resumes for friends. We believed the writing should be the hard part — not the layout, the keyword game, or whether your file would even open in a recruiter\'s ATS.</p>' +
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
          '<p>Don\'t see your role? We\'re always open to hearing from talented people. Email <a href="mailto:careers@careerforge.ai">careers@careerforge.ai</a> with a short note about what you\'d want to work on.</p>'
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
          '<p style="margin-top:14px">Want new posts in your inbox? Email us at <a href="mailto:hello@careerforge.ai?subject=Subscribe%20to%20blog">hello@careerforge.ai</a>.</p>'
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
          '<p>One page if you have under 8 years of experience. Two pages if more. Never three. Use the Resume Rewriter in CareerForge to tighten any bullet that feels long.</p>' +
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
          '<p>The ATS Resume Checker in CareerForge runs your resume through these same parsing rules and tells you exactly what to fix.</p>' +
          '<div class="modal-cta"><a href="#resume" class="btn btn-accent" data-link data-modal-close>Run an ATS check</a></div>'
      },
      'cookies': {
        eyebrow: 'Legal',
        title: 'Cookie Policy',
        body:
          '<p><b>Last updated:</b> April 12, 2026</p>' +
          '<p>We use a small number of cookies and similar technologies to keep CareerForge working. We don\'t run ad-targeting cookies, and we don\'t share data with third-party advertisers.</p>' +
          '<h3>Essential cookies</h3>' +
          '<p>Used to keep you signed in, remember your plan, and preserve your preferences (theme, billing cycle). These cannot be disabled — the product wouldn\'t work without them.</p>' +
          '<h3>Analytics cookies</h3>' +
          '<p>We use a privacy-first analytics tool (no cross-site tracking, IP anonymization) to understand which features people use. You can disable analytics from <b>Account → Privacy</b> at any time.</p>' +
          '<h3>Third-party cookies</h3>' +
          '<p>The only third-party cookie we set is from Stripe (payment processor) on the checkout page. It\'s required for secure card processing. We do not use Facebook, Google Ads, or LinkedIn Insight pixels.</p>' +
          '<h3>Managing cookies</h3>' +
          '<p>You can control cookies in your browser settings. Disabling essential cookies will sign you out and prevent the app from saving your work.</p>' +
          '<p>Questions? Email <a href="mailto:privacy@careerforge.ai">privacy@careerforge.ai</a>.</p>'
      },
      'dpa': {
        eyebrow: 'Legal',
        title: 'Data Processing Addendum',
        body:
          '<p>The Data Processing Addendum (DPA) is a contract that governs how CareerForge processes personal data on behalf of Business plan customers. It exists to satisfy GDPR, UK GDPR, CCPA, and similar privacy regulations when your team uses CareerForge to handle other people\'s information (e.g., recruiters using the platform with candidate data).</p>' +
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
          '<p>If you\'re using CareerForge as an individual job seeker, you don\'t need a DPA — your relationship with us is covered by our standard <a href="#privacy" data-modal-close>Privacy Policy</a>.</p>' +
          '<p>If you\'re a Business-plan customer or considering one, email <a href="mailto:legal@careerforge.ai?subject=DPA%20request">legal@careerforge.ai</a> and we\'ll send a countersigned copy within one business day.</p>'
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
            '<li>Two-factor authentication is required for all CareerForge employees.</li>' +
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
          '<p>Found a security issue? Email <a href="mailto:security@careerforge.ai">security@careerforge.ai</a>. We respond within 24 hours and run a paid disclosure program for valid reports.</p>'
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
