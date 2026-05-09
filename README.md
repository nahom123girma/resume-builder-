# Folio — Pro

The career & document studio. Job-winning résumé builder with AI assistance.

This is the **full SaaS build**. Real backend, real database, real AI. Not the static localStorage version.

> **Run it locally in three commands.** `cp .env.example .env`, fill in two values, then `docker compose up`. See [Docker quickstart](#setup--docker-quickstart-recommended) below.

## Status

| Working today | Coming next turn |
|---|---|
| Email + password auth (bcrypt + JWT) | Templates 5 → 18 |
| Postgres-backed cloud sync | Stripe billing tiers |
| 5 résumé templates (Broadsheet, Sidebar, Editorial, Whisper, Compact) | LinkedIn OAuth import |
| Live editor with auto-save (700ms debounce) | Real-time collaboration & comments |
| AI summary generation (Claude Haiku 4.5) | Shareable view-only links |
| AI bullet rewriting (Claude Haiku 4.5) | DOCX export |
| AI job-match analysis (Claude Sonnet 4.6) | Application tracker UI (model exists) |
| **Upload PDF/DOCX → AI parse → editable** | Drag-and-drop section reordering |
| **AI résumé audit (weak bullets, missing skills, formatting issues)** | Custom fonts/colors per résumé |
| Multi-résumé dashboard with thumbnails | Projects & certifications wizard sections |
| Duplicate / delete | OCR for scanned (image-only) PDFs |
| PDF export (via browser print) | |
| 3-pathway homepage (Upload / Match / Create) | |

---

## Setup — Docker quickstart (recommended)

The fastest way to run Folio. Brings up the app + Postgres database in one command. You don't need Node, npm, or your own database — just Docker.

### Prerequisites

- **Docker Desktop** (Mac/Windows): [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
- **Docker Engine** (Linux): [docs.docker.com/engine/install](https://docs.docker.com/engine/install/)

That's it. No Node version juggling.

### Three steps

**1. Get an Anthropic API key.** Sign up at [console.anthropic.com](https://console.anthropic.com/), add ~$5 of credit (lasts a long time at Haiku rates), create a key.

**2. Create your `.env` file:**

```bash
cp .env.example .env
```

Then open `.env` and fill in two values:

```bash
AUTH_SECRET="..."        # run: openssl rand -base64 32
ANTHROPIC_API_KEY="sk-ant-..."
```

Or do both in one shot from the project directory:

```bash
echo "AUTH_SECRET=$(openssl rand -base64 32)" > .env
echo "ANTHROPIC_API_KEY=sk-ant-paste-your-key-here" >> .env
echo "NEXT_PUBLIC_BASE_URL=http://localhost:3000" >> .env
```

**3. Start the stack:**

```bash
docker compose up
```

First run takes 2–3 minutes (downloads images, installs deps). Subsequent runs start in ~10 seconds.

When you see `✓ Ready in …`, open [localhost:3000](http://localhost:3000).

### Working with the app

| Goal | Command |
|---|---|
| Start everything | `docker compose up` |
| Start in background | `docker compose up -d` |
| Stop everything | `docker compose down` |
| Stop & wipe the database | `docker compose down -v` |
| View app logs | `docker compose logs -f app` |
| Open a shell in the app | `docker compose exec app sh` |
| Run Prisma commands | `docker compose exec app npx prisma <cmd>` |
| Open Prisma Studio | `docker compose exec app npx prisma studio` (then visit :5555) |

Source files (anything in `src/`, `prisma/`, etc.) hot-reload automatically — edit and the browser refreshes. If you change `package.json` or `prisma/schema.prisma`, restart with `docker compose restart app`.

---

## Setup — self-hosted (without Docker)

If you'd rather use your own Postgres and Node:

### 1. Install dependencies

```bash
npm install
```

You need **Node.js 20+**. If you're on something older, install via [nvm](https://github.com/nvm-sh/nvm) or [volta](https://volta.sh/).

### 2. Get a Postgres database

Pick whichever is easiest:

- **[Supabase](https://supabase.com)** — free tier, instant. Create a project, grab the connection string from Settings → Database.
- **[Neon](https://neon.tech)** — free tier, serverless. Create a project, copy the connection string.
- **[Railway](https://railway.app)** — free credits. New project → Add Postgres → copy `DATABASE_URL`.

### 3. Configure env vars

```bash
cp .env.example .env.local
```

Edit `.env.local`, uncomment `DATABASE_URL` at the bottom, and fill in all four values.

### 4. Push the schema

```bash
npx prisma db push
```

### 5. Start the dev server

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000).

---

## Using the app

Sign up at `/signup`, then either:
- Click **Upload** to drop in an existing PDF/DOCX résumé and have AI parse + audit it
- Click **Build** to pick a template and start from scratch
- Click **Match** to paste a résumé + JD and get an AI fit analysis

---

## Architecture

```
folio-pro/
├── prisma/schema.prisma         # User, Resume, Application
├── src/
│   ├── app/
│   │   ├── page.tsx             # Landing — 3 pathways
│   │   ├── login, signup        # Auth pages
│   │   ├── dashboard            # Saved résumés grid
│   │   ├── builder/             # Template picker + editor
│   │   ├── upload               # Path A — upload + AI parse (working!)
│   │   ├── match                # Path B — AI fit analysis (working!)
│   │   └── api/
│   │       ├── auth/            # signup, login, logout, me
│   │       ├── resumes/         # CRUD
│   │       ├── upload/parse     # PDF/DOCX → text → Claude → structured ResumeData
│   │       └── ai/              # summary, bullet, match, improvements
│   ├── components/
│   │   ├── editor.tsx           # The live split-pane editor
│   │   ├── templates.tsx        # 5 templates as React components
│   │   └── nav.tsx
│   └── lib/
│       ├── auth.ts              # JWT cookies, bcrypt
│       ├── db.ts                # Prisma singleton
│       ├── anthropic.ts         # Claude SDK wrapper
│       └── resume-types.ts      # Shared types
```

### How auth works

- Sign-up hashes the password with bcrypt and creates a session.
- Sessions are JWT-signed cookies (`jose` library), stored as `httpOnly` `secure` cookies named `folio_session`.
- Every server component / route handler can call `getCurrentUser()` to read the session.
- `requireUser()` (used in dashboard, builder/[id]) redirects to `/login` if not signed in.

### How AI works

Two model tiers, picked per-task in `src/lib/anthropic.ts`:

- **Haiku 4.5** for cheap fast tasks: summary generator, bullet rewrite.
- **Sonnet 4.6** for heavy lifting: job-match analysis with structured JSON output.

Every AI route validates the session before calling Anthropic — so your API key is never exposed to the browser.

### How auto-save works

`Editor` debounces every change by 700ms. After that, it `PUT`s the full `data` object to `/api/resumes/[id]`. The save indicator at the top (dot + label) shows `Saved` / `Saving…` / `Unsaved`.

---

## Deploying

Vercel is the path of least resistance:

```bash
npm install -g vercel
vercel
```

Add your env vars in Vercel's dashboard (Project → Settings → Environment Variables). Push to GitHub for CI/CD, or just `vercel --prod`.

Database: Supabase or Neon work great with Vercel. They're both serverless-friendly and have generous free tiers.

---

## Roadmap

The current build is the foundation. Future turns layer on:

1. **Templates 5 → 18.** Need 13 more truly distinct designs (academic, executive, technical, creative, etc.).
2. **Stripe billing.** Tiers: free / pro / premium. Free = 1 résumé, 1 match/week. Pro = unlimited résumés, all templates, unlimited AI. Premium = pro + analytics + priority support.
3. **LinkedIn OAuth import.** Register an app, request `r_liteprofile r_emailaddress`, map to `ResumeData`.
4. **Shareable links.** `publicSlug` field already in schema. Add `/share/[slug]/route.ts` that returns read-only HTML.
5. **Real-time collaboration.** Either Liveblocks or a custom Postgres LISTEN/NOTIFY layer.
6. **DOCX export.** `docx` npm library, server-side render the structured data.
7. **Application tracker UI.** Model exists in schema; just needs the screens.
8. **Drag-and-drop section reordering.** `@dnd-kit/core`.
9. **Custom fonts/colors per résumé.** Add `theme` JSON field; expose color picker + font selector in editor.
10. **OCR for scanned PDFs.** Currently we reject image-only PDFs. Add Tesseract or Claude Vision pass to support them.

---

## How upload + parse works (under the hood)

The `/upload` flow is one of the more interesting features:

1. **Client** — `src/app/upload/upload-client.tsx` is a state machine: `idle` (drop zone) → `uploading` → `parsing` → `auditing` → `review`. Drops/picks a file, posts as `multipart/form-data` to `/api/upload/parse`.
2. **`/api/upload/parse`** (Node runtime, 30s max duration):
   - Detects PDF or DOCX from MIME + extension
   - PDF → `unpdf` (modern serverless-friendly pdf.js wrapper)
   - DOCX → `mammoth` for raw text extraction
   - Light whitespace cleanup (collapse runs of spaces, normalize line endings, strip ligature artifacts)
   - Sends extracted text to Claude **Sonnet 4.6** with a strict JSON schema prompt — returns `ResumeData`
   - Defensively merges with `EMPTY_RESUME` so missing keys don't crash the editor
   - Persists as a new `Resume` row, returns `{ resumeId, parsed, meta }`
3. **`/api/ai/improvements`** (parallel to step 2's success):
   - Audits the parsed data, returns `{ weakBullets, missingSkills, formattingIssues, overallScore }`
   - Uses Sonnet 4.6 — accuracy matters, latency doesn't
4. **Review screen** — left column shows parsed sections at a glance, right column shows the AI audit. "Open in editor" navigates to `/builder/[resumeId]` where the data is already saved.

**Edge cases handled:**
- Files larger than 4MB → rejected with friendly error
- Wrong file type → 415 with explanation
- Image-only / scanned PDFs → 422 with "Make sure it isn't scanned image-only"
- AI returns malformed JSON → 502 with retry guidance
- AI invents fields not in schema → caught by defensive merge

**Limits:**
- 4 MB file cap (Vercel Hobby plan body limit)
- No OCR yet — scanned PDFs that have no extractable text will be rejected
- AI parsing accuracy degrades on heavily designed PDFs (multi-column sidebar templates, infographic-style résumés). Plain-text PDFs and DOCX work best.

---

## License

Private. © 2026 Folio Studio Inc.
