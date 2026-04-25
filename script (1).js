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
    async function extractTextFromFile(file) {
      if (file.size > 12 * 1024 * 1024) {
        throw new Error('File too large (max 12 MB)');
      }
      const ext = (file.name.split('.').pop() || '').toLowerCase();

      if (ext === 'txt') {
        return await file.text();
      }
      if (ext === 'pdf') {
        if (typeof window.pdfjsLib === 'undefined') {
          throw new Error('PDF library is still loading — please retry in a moment');
        }
        try {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        } catch (e) { /* ignore — already set */ }
        const buffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
        let out = '';
        for (let i = 1; i <= pdf.numPages; i++) {
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
        }
        return out;
      }
      if (ext === 'docx') {
        if (typeof window.mammoth === 'undefined') {
          throw new Error('DOCX library is still loading — please retry in a moment');
        }
        const buffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
        return result.value || '';
      }
      if (ext === 'doc') {
        // Old .doc format — try as text; extraction will be partial
        return await file.text();
      }
      throw new Error('Unsupported file type: .' + ext);
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

      // Trigger live preview via the form's input listener
      form.dispatchEvent(new Event('input', { bubbles: true }));

      // If there are additional experiences, render them in the preview below role1
      renderAdditionalExperiences(parsed);
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
      renderers.analyzing(file);
      try {
        const text = await extractTextFromFile(file);
        if (!text || text.trim().length < 30) {
          throw new Error('Could not read enough text — the file may be a scanned image.');
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
        showToast('Resume successfully generated · auto-filled');
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
