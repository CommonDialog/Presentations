import PptxGenJS from 'pptxgenjs';
import fs from 'fs';
import path from 'path';

const COLORS = {
  bgDark: '090514',        // Deep obsidian black-violet
  bgCard: '130B24',        // Rich dark purple-black card
  bgCardAlt: '1C1036',     // Elevated purple card
  bgCode: '06030D',        // Terminal black
  purplePrimary: '8B5CF6', // Electric violet
  purpleBright: 'A855F7',  // Neon purple accent
  purpleLight: 'C084FC',   // Soft lavender highlight
  purpleDeep: '4C1D95',    // Deep border purple
  white: 'F8FAFC',         // Crisp white
  textLight: 'E2E8F0',     // Primary body text
  textMuted: '94A3B8',     // Muted slate subtext
  greenPass: '10B981',     // Emerald status
  redCrit: 'F43F5E',       // Rose critical status
  amberWarn: 'F59E0B',     // Amber warning
};

function addMasterBackground(slide: PptxGenJS.Slide, pptx: PptxGenJS, slideNum?: number) {
  slide.background = { color: COLORS.bgDark };

  // Subtle top accent bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: '100%',
    h: 0.08,
    fill: { color: COLORS.purplePrimary },
    line: { color: COLORS.purplePrimary, width: 0 },
  });

  // Decorative top-right purple glow pill
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 11.2,
    y: 0.28,
    w: 1.75,
    h: 0.34,
    rectRadius: 0.17,
    fill: { color: COLORS.bgCardAlt },
    line: { color: COLORS.purpleDeep, width: 1 },
  });
  slide.addText('GDG • OCT 28, 2026', {
    x: 11.2,
    y: 0.28,
    w: 1.75,
    h: 0.34,
    fontSize: 8.5,
    bold: true,
    color: COLORS.purpleLight,
    align: 'center',
    valign: 'middle',
    fontFace: 'Segoe UI',
  });

  // Footer bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 7.05,
    w: 12.33,
    h: 0.01,
    fill: { color: COLORS.purpleDeep },
    line: { color: COLORS.purpleDeep, width: 0 },
  });

  slide.addText('Spec  →  Swarm  →  Software   |   Google Developer Group', {
    x: 0.5,
    y: 7.12,
    w: 8.0,
    h: 0.28,
    fontSize: 9,
    color: COLORS.textMuted,
    fontFace: 'Segoe UI',
  });

  if (slideNum !== undefined) {
    slide.addText(`${slideNum} / 12`, {
      x: 11.5,
      y: 7.12,
      w: 1.33,
      h: 0.28,
      fontSize: 9,
      bold: true,
      color: COLORS.purpleLight,
      align: 'right',
      fontFace: 'Segoe UI',
    });
  }
}

function addSlideHeader(
  slide: PptxGenJS.Slide,
  kicker: string,
  title: string,
  subtitle?: string
) {
  slide.addText(kicker.toUpperCase(), {
    x: 0.6,
    y: 0.3,
    w: 10.2,
    h: 0.26,
    fontSize: 10,
    bold: true,
    color: COLORS.purpleLight,
    charSpacing: 2,
    fontFace: 'Segoe UI',
  });

  slide.addText(title, {
    x: 0.6,
    y: 0.56,
    w: 11.5,
    h: 0.52,
    fontSize: 25,
    bold: true,
    color: COLORS.white,
    fontFace: 'Segoe UI',
  });

  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.6,
      y: 1.1,
      w: 11.8,
      h: 0.36,
      fontSize: 12.5,
      color: COLORS.textMuted,
      fontFace: 'Segoe UI',
    });
  }
}

async function buildDeck() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches
  pptx.author = 'Google Developer Group Speaker';
  pptx.company = 'Google Developer Group';
  pptx.subject = 'Spec -> Swarm -> Software: Multi-Agent Swarms & Vertex AI';
  pptx.title = 'Spec -> Swarm -> Software';

  // =========================================================================
  // SLIDE 1: TITLE SLIDE
  // =========================================================================
  const s1 = pptx.addSlide();
  s1.background = { color: COLORS.bgDark };

  // Dramatic purple accent bars
  s1.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.18,
    h: '100%',
    fill: { color: COLORS.purplePrimary },
    line: { color: COLORS.purplePrimary, width: 0 },
  });

  s1.addShape(pptx.ShapeType.roundRect, {
    x: 0.8,
    y: 0.9,
    w: 4.3,
    h: 0.42,
    rectRadius: 0.21,
    fill: { color: COLORS.bgCardAlt },
    line: { color: COLORS.purplePrimary, width: 1.2 },
  });
  s1.addText('GOOGLE DEVELOPER GROUP  •  WED, OCT 28, 2026', {
    x: 0.8,
    y: 0.9,
    w: 4.3,
    h: 0.42,
    fontSize: 9.5,
    bold: true,
    color: COLORS.purpleLight,
    align: 'center',
    valign: 'middle',
    fontFace: 'Segoe UI',
  });

  s1.addText('Spec  →  Swarm  →  Software', {
    x: 0.8,
    y: 1.65,
    w: 11.8,
    h: 1.1,
    fontSize: 44,
    bold: true,
    color: COLORS.white,
    fontFace: 'Segoe UI',
  });

  s1.addText(
    'How we went from a Markdown Spec, built an app with a 4-Agent Coding Swarm,\nand survived the trenches of Google Cloud Vertex AI & Cloud Run deployment.',
    {
      x: 0.8,
      y: 2.8,
      w: 10.8,
      h: 0.9,
      fontSize: 16,
      color: COLORS.textLight,
      fontFace: 'Segoe UI',
    }
  );

  // 3 Hero Pillars on Title Slide
  const pillars = [
    {
      step: '01  THE SPEC',
      title: 'SPEC.md Contract',
      desc: 'Data models, 12 REST endpoints, atomic persistence & strict acceptance criteria.',
    },
    {
      step: '02  THE SWARM',
      title: 'PO → Architect → Builder ↔ QA',
      desc: 'Autonomous 4-agent dev swarm with context budgets & blocker-only QA gates.',
    },
    {
      step: '03  VERTEX AI',
      title: 'Review, Test Gen & Cloud Run',
      desc: '4-stage Vertex AI pipeline that audits code, writes tests, diagnoses bugs & deploys.',
    },
  ];

  pillars.forEach((p, idx) => {
    const x = 0.8 + idx * 4.0;
    s1.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 4.25,
      w: 3.75,
      h: 2.25,
      rectRadius: 0.12,
      fill: { color: COLORS.bgCard },
      line: { color: COLORS.purplePrimary, width: 1.2 },
    });
    s1.addText(p.step, {
      x: x + 0.25,
      y: 4.45,
      w: 3.25,
      h: 0.3,
      fontSize: 10,
      bold: true,
      color: COLORS.purpleLight,
      charSpacing: 1.5,
      fontFace: 'Segoe UI',
    });
    s1.addText(p.title, {
      x: x + 0.25,
      y: 4.8,
      w: 3.25,
      h: 0.45,
      fontSize: 15.5,
      bold: true,
      color: COLORS.white,
      fontFace: 'Segoe UI',
    });
    s1.addText(p.desc, {
      x: x + 0.25,
      y: 5.3,
      w: 3.25,
      h: 0.95,
      fontSize: 11.5,
      color: COLORS.textMuted,
      fontFace: 'Segoe UI',
    });
  });

  s1.addNotes(
    'Welcome to Spec -> Swarm -> Software! Tonight we are walking through a real end-to-end engineering journey: how we wrote a tight specification for AICRM, ran it through a 4-agent coding swarm, and then wired up Google Cloud Vertex AI and Cloud Run to review code, generate unit tests, diagnose problems, and deploy live.'
  );

  // =========================================================================
  // SLIDE 2: WHY "VIBE CODING" HITS A WALL (AND WHAT WORKS INSTEAD)
  // =========================================================================
  const s2 = pptx.addSlide();
  addMasterBackground(s2, pptx, 2);
  addSlideHeader(
    s2,
    'The Problem & The Pipeline',
    'Why Single-Prompt "Vibe Coding" Breaks on Real Software',
    'Moving from ad-hoc chat prompts to a repeatable Spec → Swarm → Vertex AI engineering pipeline.'
  );

  // Left card: Vibe Coding
  s2.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 1.65,
    w: 5.8,
    h: 5.0,
    rectRadius: 0.12,
    fill: { color: COLORS.bgCard },
    line: { color: COLORS.redCrit, width: 1.2 },
  });
  s2.addText('❌  Ad-Hoc Prompting ("Vibe Coding")', {
    x: 0.9,
    y: 1.9,
    w: 5.2,
    h: 0.4,
    fontSize: 16,
    bold: true,
    color: COLORS.redCrit,
    fontFace: 'Segoe UI',
  });
  s2.addText(
    [
      { text: '• Ambiguous Requirements: ', options: { bold: true, color: COLORS.white } },
      { text: 'The model guesses your data schema and API routes differently on every turn.\n\n', options: { color: COLORS.textLight } },
      { text: '• Context Window Bloat: ', options: { bold: true, color: COLORS.white } },
      { text: 'One giant chat session mixes product decisions, architecture, coding, and debugging.\n\n', options: { color: COLORS.textLight } },
      { text: '• Endless Nitpick Loops: ', options: { bold: true, color: COLORS.white } },
      { text: 'Agents rewrite working code to fix imaginary style issues while breaking core endpoints.\n\n', options: { color: COLORS.textLight } },
      { text: '• "It Works on My Machine": ', options: { bold: true, color: COLORS.white } },
      { text: 'Zero automated security review, edge-case test generation, or deployment gating.', options: { color: COLORS.textLight } },
    ],
    {
      x: 0.9,
      y: 2.5,
      w: 5.2,
      h: 3.8,
      fontSize: 12.5,
      valign: 'top',
      fontFace: 'Segoe UI',
    }
  );

  // Right card: Spec -> Swarm -> Software
  s2.addShape(pptx.ShapeType.roundRect, {
    x: 6.8,
    y: 1.65,
    w: 5.9,
    h: 5.0,
    rectRadius: 0.12,
    fill: { color: COLORS.bgCardAlt },
    line: { color: COLORS.purpleBright, width: 1.5 },
  });
  s2.addText('✅  Spec → Swarm → Vertex AI Pipeline', {
    x: 7.1,
    y: 1.9,
    w: 5.3,
    h: 0.4,
    fontSize: 16,
    bold: true,
    color: COLORS.purpleLight,
    fontFace: 'Segoe UI',
  });
  s2.addText(
    [
      { text: '1. Markdown Spec as Source of Truth: ', options: { bold: true, color: COLORS.white } },
      { text: 'Explicit TypeScript interfaces, REST routes, and persistence rules in SPEC.md.\n\n', options: { color: COLORS.textLight } },
      { text: '2. Role-Specialized 4-Agent Swarm: ', options: { bold: true, color: COLORS.white } },
      { text: 'PO defines Work Packages → Architect maps exact file:line pointers → Builder codes → QA verifies.\n\n', options: { color: COLORS.textLight } },
      { text: '3. Vertex AI Pre-Deployment Gate: ', options: { bold: true, color: COLORS.white } },
      { text: 'Audits code against SPEC.md, auto-generates Vitest suites, and blocks bad deploys.\n\n', options: { color: COLORS.textLight } },
      { text: '4. Serverless Cloud Run Delivery: ', options: { bold: true, color: COLORS.white } },
      { text: 'One command packages and deploys the verified container live to Google Cloud Run.', options: { color: COLORS.textLight } },
    ],
    {
      x: 7.1,
      y: 2.5,
      w: 5.3,
      h: 3.8,
      fontSize: 12.5,
      valign: 'top',
      fontFace: 'Segoe UI',
    }
  );

  s2.addNotes(
    'Explain why single-prompt coding fails once an application has real auth, file persistence, and external APIs. Show how separating Specification, Multi-Agent Swarm execution, and Vertex AI release gating solves each failure mode.'
  );

  // =========================================================================
  // SLIDE 3: ACT I — HOW TO WRITE AN AGENT-READY SPEC
  // =========================================================================
  const s3 = pptx.addSlide();
  addMasterBackground(s3, pptx, 3);
  addSlideHeader(
    s3,
    'Act I • Writing the Specification',
    'How to Write a Spec That Agents Actually Follow',
    'A great SPEC.md is short, unambiguous, and defines contracts rather than implementation prose.'
  );

  const specBlocks = [
    {
      num: '01',
      title: '1-Paragraph Overview & User Loop',
      body: 'Define who logs in, what action they trigger (e.g. "KC Plumbers within 25 miles"), and the exact outcome (20 structured leads saved to local storage).',
    },
    {
      num: '02',
      title: 'Explicit Stack & Non-Functional Rules',
      body: 'Lock down versions & invariants upfront: React 19, Vite, Tailwind, Express + TypeScript, and atomic file writes (write to .tmp then rename).',
    },
    {
      num: '03',
      title: 'Strict Data Models (Field-by-Field)',
      body: 'List every property & type on Contact and LeadList (UUID v4, status union "New" | "Contacted" | "Qualified" | "Disqualified", ISO timestamps).',
    },
    {
      num: '04',
      title: 'Complete REST API Contract Table',
      body: 'Specify every HTTP method & route (/api/auth/login, /api/lists/search, /api/lists/:id/append, /api/lists/:id/export) so frontend & backend never drift.',
    },
  ];

  specBlocks.forEach((b, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 0.6 + col * 6.15;
    const y = 1.65 + row * 2.55;

    s3.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w: 5.95,
      h: 2.3,
      rectRadius: 0.1,
      fill: { color: COLORS.bgCard },
      line: { color: COLORS.purplePrimary, width: 1.2 },
    });

    s3.addShape(pptx.ShapeType.roundRect, {
      x: x + 0.25,
      y: y + 0.25,
      w: 0.65,
      h: 0.45,
      rectRadius: 0.08,
      fill: { color: COLORS.purplePrimary },
      line: { color: COLORS.purplePrimary, width: 0 },
    });
    s3.addText(b.num, {
      x: x + 0.25,
      y: y + 0.25,
      w: 0.65,
      h: 0.45,
      fontSize: 13,
      bold: true,
      color: COLORS.white,
      align: 'center',
      valign: 'middle',
      fontFace: 'Segoe UI',
    });

    s3.addText(b.title, {
      x: x + 1.05,
      y: y + 0.25,
      w: 4.65,
      h: 0.45,
      fontSize: 15,
      bold: true,
      color: COLORS.white,
      valign: 'middle',
      fontFace: 'Segoe UI',
    });

    s3.addText(b.body, {
      x: x + 0.25,
      y: y + 0.85,
      w: 5.45,
      h: 1.2,
      fontSize: 12,
      color: COLORS.textLight,
      valign: 'top',
      fontFace: 'Segoe UI',
    });
  });

  s3.addNotes(
    'Walk through the 4 sections of our 51-line SPEC.md file. Emphasize that a 50-line markdown file with exact field names and HTTP routes beats a 10-page product document full of fluff.'
  );

  // =========================================================================
  // SLIDE 4: CASE STUDY — INSIDE AICRM'S SPEC & EVOLUTION
  // =========================================================================
  const s4 = pptx.addSlide();
  addMasterBackground(s4, pptx, 4);
  addSlideHeader(
    s4,
    'Act I • The Application We Built',
    'Case Study: AICRM (AI Lead Generation & Contact Manager)',
    'From initial SPEC.md to a 3-step Google Places + Web Scraper + Gemini Call-Script pipeline.'
  );

  // Left: Code snippet from SPEC.md
  s4.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 1.65,
    w: 6.2,
    h: 5.0,
    rectRadius: 0.1,
    fill: { color: COLORS.bgCode },
    line: { color: COLORS.purpleDeep, width: 1.5 },
  });
  s4.addText('c:\\Dev\\AICRM\\SPEC.md (Excerpt)', {
    x: 0.85,
    y: 1.8,
    w: 5.7,
    h: 0.35,
    fontSize: 11,
    bold: true,
    color: COLORS.purpleLight,
    fontFace: 'Consolas',
  });
  s4.addText(
    `### Contact (Lead)
- id: string (UUID v4)
- businessName, contactName, contactTitle
- phone, email, website, address
- description, sourceUrl, notes
- status: 'New' | 'Contacted' | 'Qualified' | 'Disqualified'

### REST API Specification
- POST /api/auth/login       (JWT Auth)
- POST /api/lists/search     (Find 20 Leads)
- POST /api/lists/:id/append (Add 20 Non-Duplicates)
- GET  /api/lists/:id/export (CSV Export)
- PATCH /api/lists/:id/contacts/:contactId`,
    {
      x: 0.85,
      y: 2.25,
      w: 5.7,
      h: 4.1,
      fontSize: 11,
      color: COLORS.textLight,
      fontFace: 'Consolas',
      valign: 'top',
    }
  );

  // Right: Architectural Evolution in AICRM
  const stepsRight = [
    {
      badge: 'STEP 1 • DISCOVERY (< 1 sec)',
      title: 'Google Places API (New) Text Search',
      desc: 'Finds 20 real local businesses matching criteria with verified addresses, Google Maps URLs, and deduplication.',
    },
    {
      badge: 'STEP 2 • ENRICHMENT',
      title: 'Places Details + Live Website Scraper',
      desc: 'Fetches phone numbers, official URLs, and scrapes business websites for public email addresses & meta descriptions.',
    },
    {
      badge: 'STEP 3 • AI GENERATION',
      title: 'Gemini Cold-Call Script + Lead Scoring',
      desc: 'Generates tailored B2B cold-call scripts (pattern interrupt, value hook, objection pivot) & scores leads 0–100.',
    },
  ];

  stepsRight.forEach((st, idx) => {
    const y = 1.65 + idx * 1.72;
    s4.addShape(pptx.ShapeType.roundRect, {
      x: 7.05,
      y,
      w: 5.65,
      h: 1.55,
      rectRadius: 0.1,
      fill: { color: COLORS.bgCard },
      line: { color: COLORS.purplePrimary, width: 1.2 },
    });
    s4.addText(st.badge, {
      x: 7.3,
      y: y + 0.15,
      w: 5.1,
      h: 0.28,
      fontSize: 9.5,
      bold: true,
      color: COLORS.purpleLight,
      fontFace: 'Segoe UI',
    });
    s4.addText(st.title, {
      x: 7.3,
      y: y + 0.43,
      w: 5.1,
      h: 0.35,
      fontSize: 14,
      bold: true,
      color: COLORS.white,
      fontFace: 'Segoe UI',
    });
    s4.addText(st.desc, {
      x: 7.3,
      y: y + 0.8,
      w: 5.1,
      h: 0.65,
      fontSize: 11,
      color: COLORS.textMuted,
      fontFace: 'Segoe UI',
    });
  });

  s4.addNotes(
    'Show how AICRM works in practice and foreshadow a fun twist later in the talk: when we evolved the app from pure Gemini Search Grounding to a faster 3-step Places + Scraper + Gemini pipeline, we forgot to update SPEC.md—and Vertex AI Code Review caught us red-handed!'
  );

  // =========================================================================
  // SLIDE 5: ACT II — BUILDING THE 4-AGENT DEV SWARM
  // =========================================================================
  const s5 = pptx.addSlide();
  addMasterBackground(s5, pptx, 5);
  addSlideHeader(
    s5,
    'Act II • Multi-Agent Swarm Architecture',
    'How We Built the 4-Agent Coding Swarm (dev-swarm)',
    'Turning a single primary agent into an Orchestrator coordinating 4 specialized subagents.'
  );

  const agents = [
    {
      role: '1. PO AGENT',
      tag: 'Read-Only • Spec & WPs',
      desc: 'Reads high-level repo context, interviews user (or runs autonomous), and outputs max 4 Work Packages (WP-1..WP-4) with max 6 Acceptance Criteria (AC-1..AC-6).',
    },
    {
      role: '2. ARCHITECT AGENT',
      tag: 'Read-Only • Blueprint',
      desc: 'Scans the codebase ONCE and produces a Technical Blueprint with exact file:line pointers so downstream agents never waste tokens searching.',
    },
    {
      role: '3. BUILDER AGENT',
      tag: 'Write-Enabled • Code',
      desc: 'Single persistent builder instance (warm context) that implements ALL Work Packages (WP-1..WP-M) and verifies clean compilation before QA.',
    },
    {
      role: '4. QA AGENT',
      tag: 'Write-Enabled • Gate',
      desc: 'Runs ONCE at the end. Writes focused tests mapped to AC-1..AC-6 and issues VERDICT: PASS or FAIL (max 2 fix loops with Builder).',
    },
  ];

  agents.forEach((a, idx) => {
    const x = 0.6 + idx * 3.08;
    s5.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 1.7,
      w: 2.9,
      h: 3.45,
      rectRadius: 0.12,
      fill: { color: COLORS.bgCard },
      line: { color: COLORS.purpleBright, width: 1.3 },
    });
    s5.addText(a.role, {
      x: x + 0.2,
      y: 1.9,
      w: 2.5,
      h: 0.38,
      fontSize: 13.5,
      bold: true,
      color: COLORS.white,
      fontFace: 'Segoe UI',
    });
    s5.addShape(pptx.ShapeType.roundRect, {
      x: x + 0.2,
      y: 2.35,
      w: 2.5,
      h: 0.32,
      rectRadius: 0.08,
      fill: { color: COLORS.bgCardAlt },
      line: { color: COLORS.purpleDeep, width: 1 },
    });
    s5.addText(a.tag, {
      x: x + 0.2,
      y: 2.35,
      w: 2.5,
      h: 0.32,
      fontSize: 9.5,
      bold: true,
      color: COLORS.purpleLight,
      align: 'center',
      valign: 'middle',
      fontFace: 'Segoe UI',
    });
    s5.addText(a.desc, {
      x: x + 0.2,
      y: 2.85,
      w: 2.5,
      h: 2.1,
      fontSize: 11,
      color: COLORS.textLight,
      valign: 'top',
      fontFace: 'Segoe UI',
    });
  });

  // Bottom bar: 3 Modes of Operation
  s5.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 5.4,
    w: 12.13,
    h: 1.35,
    rectRadius: 0.1,
    fill: { color: COLORS.bgCardAlt },
    line: { color: COLORS.purplePrimary, width: 1 },
  });
  s5.addText('THREE SWARM EXECUTION MODES', {
    x: 0.85,
    y: 5.52,
    w: 11.6,
    h: 0.28,
    fontSize: 10,
    bold: true,
    color: COLORS.purpleLight,
    charSpacing: 1.5,
    fontFace: 'Segoe UI',
  });
  s5.addText(
    [
      { text: 'Mode A (Interactive): ', options: { bold: true, color: COLORS.white } },
      { text: 'PO interviews user → Sign-off → Auto build     |     ', options: { color: COLORS.textLight } },
      { text: 'Mode B (Most Auto): ', options: { bold: true, color: COLORS.white } },
      { text: '1-shot PO spec → 1 sign-off → Auto build     |     ', options: { color: COLORS.textLight } },
      { text: 'Mode C (Full Auto): ', options: { bold: true, color: COLORS.white } },
      { text: 'Zero stops from PO to Final QA delivery.', options: { color: COLORS.textLight } },
    ],
    {
      x: 0.85,
      y: 5.88,
      w: 11.6,
      h: 0.65,
      fontSize: 11.5,
      fontFace: 'Segoe UI',
    }
  );

  s5.addNotes(
    'Explain how dev-swarm (c:\\Dev\\.agents\\skills\\dev-swarm\\SKILL.md) is structured. Instead of one agent doing everything, we separate Product Owner, Architect, Builder, and QA—and support Interactive, Most Auto, and Full Auto modes.'
  );

  // =========================================================================
  // SLIDE 6: SWARM ENGINEERING — ANTI-RUNAWAY GUARDRAILS
  // =========================================================================
  const s6 = pptx.addSlide();
  addMasterBackground(s6, pptx, 6);
  addSlideHeader(
    s6,
    'Act II • Swarm Guardrails',
    'How We Stopped the Swarm from Burning Tokens & Looping Forever',
    'Six hard engineering rules we baked into SKILL.md after watching early agent swarms go off the rails.'
  );

  const guardrails = [
    {
      title: '1. Explore Once, Pass Exact file:line Pointers',
      desc: 'Architect scans the repo once. Builder & QA are forbidden from broad repo searches—they only touch the exact files & lines in the blueprint.',
    },
    {
      title: '2. Single Persistent Builder Instance',
      desc: 'Never spawn parallel builders that overwrite each other. Keep 1 builder-agent alive via send_message so its context stays warm.',
    },
    {
      title: '3. No QA Until 100% of Dev Work Is Done',
      desc: 'Running QA after partial work packages wastes half your tokens. Builder must finish all WPs and compile cleanly before QA wakes up.',
    },
    {
      title: '4. Compact Handoffs (Max 350 Words)',
      desc: 'Pass concise bullet points and file:line references between agents—never paste entire source files or chat transcripts into prompts.',
    },
    {
      title: '5. Blocker-Only QA Gate (P0/P1 Only)',
      desc: 'QA can only FAIL a build for broken compilation, failing tests, or an unmet Acceptance Criterion—never for code style nitpicks.',
    },
    {
      title: '6. No Moving Goalposts (Max 2 Fix Loops)',
      desc: 'On re-review, QA may only verify the specific BUG-X items from Iteration 1 and is forbidden from inventing brand-new objections.',
    },
  ];

  guardrails.forEach((g, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 0.6 + col * 6.15;
    const y = 1.65 + row * 1.72;

    s6.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w: 5.95,
      h: 1.52,
      rectRadius: 0.1,
      fill: { color: COLORS.bgCard },
      line: { color: COLORS.purplePrimary, width: 1 },
    });
    s6.addText(g.title, {
      x: x + 0.25,
      y: y + 0.18,
      w: 5.45,
      h: 0.35,
      fontSize: 13.5,
      bold: true,
      color: COLORS.purpleLight,
      fontFace: 'Segoe UI',
    });
    s6.addText(g.desc, {
      x: x + 0.25,
      y: y + 0.56,
      w: 5.45,
      h: 0.85,
      fontSize: 11,
      color: COLORS.textLight,
      fontFace: 'Segoe UI',
    });
  });

  s6.addNotes(
    'This is often the audience’s favorite slide: anyone who has built multi-agent systems knows they love to burn tokens re-reading the codebase or arguing over style nitpicks. These 6 guardrails keep the swarm fast, deterministic, and cheap.'
  );

  // =========================================================================
  // SLIDE 7: ACT III — ENTER GOOGLE CLOUD VERTEX AI
  // =========================================================================
  const s7 = pptx.addSlide();
  addMasterBackground(s7, pptx, 7);
  addSlideHeader(
    s7,
    'Act III • Enterprise AI Infrastructure',
    'Why We Moved to Google Cloud Vertex AI for Pre-Deployment',
    'What Vertex AI + Cloud Run gives you that a basic AI Studio key cannot.'
  );

  const vertexBenefits = [
    {
      title: 'Keyless IAM Authentication',
      desc: 'No leaked API keys in production. Local dev uses Application Default Credentials (ADC), and Cloud Run uses its built-in Service Account identity automatically.',
    },
    {
      title: 'Unified GCP Billing & Credits',
      desc: 'One Google Cloud billing account covers Vertex AI model calls, Cloud Build, and serverless Cloud Run hosting (scales to $0 when idle).',
    },
    {
      title: 'Zero Data Training Guarantee',
      desc: 'Your proprietary source code (sent during AI Code Review) and customer CRM leads are contractually never used to train Google models.',
    },
    {
      title: '1-Line SDK Switch (@google/genai)',
      desc: 'The exact same GoogleGenAI SDK switches from AI Studio to Vertex AI by passing { vertexai: true, project, location }.',
    },
  ];

  vertexBenefits.forEach((vb, idx) => {
    const y = 1.65 + idx * 1.25;
    s7.addShape(pptx.ShapeType.roundRect, {
      x: 0.6,
      y,
      w: 6.3,
      h: 1.1,
      rectRadius: 0.08,
      fill: { color: COLORS.bgCard },
      line: { color: COLORS.purplePrimary, width: 1 },
    });
    s7.addText(vb.title, {
      x: 0.85,
      y: y + 0.12,
      w: 5.8,
      h: 0.32,
      fontSize: 13.5,
      bold: true,
      color: COLORS.white,
      fontFace: 'Segoe UI',
    });
    s7.addText(vb.desc, {
      x: 0.85,
      y: y + 0.45,
      w: 5.8,
      h: 0.55,
      fontSize: 10.8,
      color: COLORS.textMuted,
      fontFace: 'Segoe UI',
    });
  });

  // Right side: Code comparison
  s7.addShape(pptx.ShapeType.roundRect, {
    x: 7.2,
    y: 1.65,
    w: 5.5,
    h: 4.85,
    rectRadius: 0.1,
    fill: { color: COLORS.bgCode },
    line: { color: COLORS.purpleBright, width: 1.4 },
  });
  s7.addText('scripts/vertex-client.ts', {
    x: 7.45,
    y: 1.85,
    w: 5.0,
    h: 0.35,
    fontSize: 11.5,
    bold: true,
    color: COLORS.purpleLight,
    fontFace: 'Consolas',
  });
  s7.addText(
    `import { GoogleGenAI } from '@google/genai';

// Connects directly to Google Cloud Vertex AI
const client = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: 'global',
});

const response = await client.models.generateContent({
  model: 'gemini-3-flash-preview',
  contents: prompt,
  config: {
    responseMimeType: 'application/json',
    responseSchema: reviewSchema,
    thinkingConfig: { thinkingBudget: 0 },
  },
});`,
    {
      x: 7.45,
      y: 2.3,
      w: 5.0,
      h: 4.0,
      fontSize: 10.5,
      color: COLORS.textLight,
      fontFace: 'Consolas',
      valign: 'top',
    }
  );

  s7.addNotes(
    'Highlight how clean the @google/genai SDK is: switching from an AI Studio key to Google Cloud Vertex AI is literally 3 lines of config (vertexai: true, project, location).'
  );

  // =========================================================================
  // SLIDE 8: THE "FUN" WITH SETTING UP VERTEX AI (WAR STORIES!)
  // =========================================================================
  const s8 = pptx.addSlide();
  addMasterBackground(s8, pptx, 8);
  addSlideHeader(
    s8,
    'Act III • Real-World War Stories',
    'The "Fun" with Setting Up Vertex AI (What the Docs Don’t Tell You)',
    'Every real cloud migration has plot twists—here are the 4 bosses we fought and beat.'
  );

  const warStories = [
    {
      badge: 'BOSS #1 • HTTP 402',
      title: '"Your prepayment credits are depleted"',
      pain: 'Our original AI Studio API key suddenly died mid-test with a 402 Resource Exhausted error.',
      fix: 'Switched to Vertex AI (USE_VERTEX_AI=true) backed by Google Cloud billing instead of prepaid AI Studio credits.',
    },
    {
      badge: 'BOSS #2 • THE CLI',
      title: 'The 8-Minute gcloud SDK Install',
      pain: 'winget install Google.CloudSDK downloads an embedded Python runtime + thousands of files while looking frozen.',
      fix: 'Installed the SDK and configured scripts/vertex-pipeline.ts to auto-detect gcloud.cmd on Windows.',
    },
    {
      badge: 'BOSS #3 • AUTH TRAP',
      title: 'gcloud auth login != Application Default Credentials',
      pain: 'Ran gcloud auth login, felt great, ran Node.js... and hit "Could not load the default credentials"!',
      fix: 'gcloud auth login only logs in the CLI. Node SDKs require: gcloud auth application-default login.',
    },
    {
      badge: 'BOSS #4 • HTTP 404',
      title: 'The Region & Model Name Plot Twist',
      pain: 'us-central1 + gemini-2.5-flash threw 404 Publisher Model Not Found on our project!',
      fix: 'Probed Vertex endpoints automatically and discovered our project uses location: "global" + "gemini-3-flash-preview"!',
    },
  ];

  warStories.forEach((ws, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 0.6 + col * 6.15;
    const y = 1.65 + row * 2.55;

    s8.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w: 5.95,
      h: 2.35,
      rectRadius: 0.1,
      fill: { color: COLORS.bgCard },
      line: { color: COLORS.purpleBright, width: 1.2 },
    });

    s8.addText(ws.badge, {
      x: x + 0.25,
      y: y + 0.18,
      w: 5.4,
      h: 0.26,
      fontSize: 9.5,
      bold: true,
      color: COLORS.amberWarn,
      charSpacing: 1.2,
      fontFace: 'Segoe UI',
    });

    s8.addText(ws.title, {
      x: x + 0.25,
      y: y + 0.45,
      w: 5.4,
      h: 0.35,
      fontSize: 14,
      bold: true,
      color: COLORS.white,
      fontFace: 'Segoe UI',
    });

    s8.addText(
      [
        { text: 'Trap: ', options: { bold: true, color: COLORS.redCrit } },
        { text: `${ws.pain}\n`, options: { color: COLORS.textLight } },
        { text: 'Fix: ', options: { bold: true, color: COLORS.greenPass } },
        { text: ws.fix, options: { color: COLORS.textLight } },
      ],
      {
        x: x + 0.25,
        y: y + 0.85,
        w: 5.45,
        h: 1.35,
        fontSize: 11,
        valign: 'top',
        fontFace: 'Segoe UI',
      }
    );
  });

  s8.addNotes(
    'This is the comedy/reality section of the talk! Walk the GDG audience through all 4 errors we actually hit setting this up: the 402 prepayment error, waiting on the gcloud installer, the classic gcloud auth login vs application-default login trap, and discovering that gemini-3-flash-preview lives on the global endpoint.'
  );

  // =========================================================================
  // SLIDE 9: THE 4-STAGE VERTEX AI PRE-DEPLOYMENT PIPELINE
  // =========================================================================
  const s9 = pptx.addSlide();
  addMasterBackground(s9, pptx, 9);
  addSlideHeader(
    s9,
    'Act III • Automated Release Engineering',
    'One Command: Review → Generate Tests → Diagnose → Deploy',
    'How npm run vertex:deploy orchestrates Vertex AI and Google Cloud Run.'
  );

  const stages = [
    {
      stage: 'STAGE 1',
      name: 'AI Code Review',
      script: 'scripts/ai-review.ts',
      items: [
        'Bundles server/src, client/src & SPEC.md',
        'Audits security, race conditions & spec compliance',
        'Outputs readiness score (0–100) + reports/code-review.md',
        'Blocks deploy on CRITICAL findings',
      ],
    },
    {
      stage: 'STAGE 2',
      name: 'AI Test Generation',
      script: 'scripts/ai-generate-tests.ts',
      items: [
        'Inspects Express routes & data models',
        'Generates Vitest + Supertest integration suite',
        'Covers auth, 400/404s, deduplication & CSV escaping',
        'Writes server/tests/vertex-generated.test.ts',
      ],
    },
    {
      stage: 'STAGE 3',
      name: 'Identify Problems',
      script: 'scripts/ai-diagnose.ts',
      items: [
        'Runs all 19 unit & integration tests + tsc/vite build',
        'If any step fails, sends stack trace to Vertex AI',
        'Pinpoints exact root cause & code fix',
        'Saves reports/problem-diagnosis.md',
      ],
    },
    {
      stage: 'STAGE 4',
      name: 'Cloud Run Deploy',
      script: 'gcloud run deploy',
      items: [
        'Packages pre-built dist/ into slim Node 22 Alpine image',
        'Pushes to Google Artifact Registry',
        'Deploys serverless container to us-central1',
        'Routes 100% traffic to live HTTPS URL',
      ],
    },
  ];

  stages.forEach((st, idx) => {
    const x = 0.6 + idx * 3.08;
    s9.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 1.7,
      w: 2.9,
      h: 4.9,
      rectRadius: 0.12,
      fill: { color: COLORS.bgCard },
      line: { color: COLORS.purplePrimary, width: 1.3 },
    });

    s9.addShape(pptx.ShapeType.roundRect, {
      x: x + 0.2,
      y: 1.9,
      w: 1.1,
      h: 0.3,
      rectRadius: 0.06,
      fill: { color: COLORS.purplePrimary },
      line: { color: COLORS.purplePrimary, width: 0 },
    });
    s9.addText(st.stage, {
      x: x + 0.2,
      y: 1.9,
      w: 1.1,
      h: 0.3,
      fontSize: 9.5,
      bold: true,
      color: COLORS.white,
      align: 'center',
      valign: 'middle',
      fontFace: 'Segoe UI',
    });

    s9.addText(st.name, {
      x: x + 0.2,
      y: 2.32,
      w: 2.5,
      h: 0.38,
      fontSize: 15,
      bold: true,
      color: COLORS.white,
      fontFace: 'Segoe UI',
    });

    s9.addText(st.script, {
      x: x + 0.2,
      y: 2.7,
      w: 2.5,
      h: 0.28,
      fontSize: 10,
      color: COLORS.purpleLight,
      fontFace: 'Consolas',
    });

    const bullets = st.items.map((it) => `• ${it}`).join('\n\n');
    s9.addText(bullets, {
      x: x + 0.2,
      y: 3.15,
      w: 2.5,
      h: 3.2,
      fontSize: 10.8,
      color: COLORS.textLight,
      valign: 'top',
      fontFace: 'Segoe UI',
    });
  });

  s9.addNotes(
    'Walk through the 4 stages of scripts/vertex-pipeline.ts. Show how Vertex AI acts as both our Principal Security Reviewer (Stage 1), Staff QA Automation Engineer (Stage 2), and Site Reliability Engineer (Stage 3) before Cloud Run ships Stage 4.'
  );

  // =========================================================================
  // SLIDE 10: WHEN VERTEX AI BLOCKED OUR DEPLOY (REAL OUTPUT!)
  // =========================================================================
  const s10 = pptx.addSlide();
  addMasterBackground(s10, pptx, 10);
  addSlideHeader(
    s10,
    'Act III • Real Pipeline Output',
    'When Vertex AI Blocked Our Deployment (And Caught Real Bugs!)',
    'Actual terminal output from our first live run of npm run ai:review on AICRM.'
  );

  // Terminal output box
  s10.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 1.65,
    w: 7.3,
    h: 5.0,
    rectRadius: 0.1,
    fill: { color: COLORS.bgCode },
    line: { color: COLORS.redCrit, width: 1.4 },
  });

  s10.addText('Terminal — npm run ai:review (gemini-3-flash-preview)', {
    x: 0.85,
    y: 1.82,
    w: 6.8,
    h: 0.32,
    fontSize: 10.5,
    bold: true,
    color: COLORS.purpleLight,
    fontFace: 'Consolas',
  });

  s10.addText(
    `Connecting to Google Cloud Vertex AI (<project-id> / global)...

Readiness Score: 62/100 | Status: BLOCKED

Findings: 1 CRITICAL, 3 WARNING, 2 SUGGESTION
[CRITICAL] (server/src/storage.ts)
  Data Loss via Concurrent Write Race Condition
  -> Implement a mutex/lock or promise queue in ListStorage so
     concurrent enrichment requests do not overwrite lists.json.

[WARNING] (server/src/gemini.ts)
  Specification Non-Compliance: Missing Search Grounding
  -> SPEC.md specifies Gemini Search Grounding, but gemini.ts
     uses Google Places API (New) + Website Scraping.

[WARNING] (server/src/app.ts)
  Hardcoded Default JWT Secret Fallback

Deployment blocked due to CRITICAL code review findings.`,
    {
      x: 0.85,
      y: 2.22,
      w: 6.8,
      h: 4.2,
      fontSize: 10.2,
      color: COLORS.textLight,
      fontFace: 'Consolas',
      valign: 'top',
    }
  );

  // Right card: Why this is awesome + Test Gen stats
  s10.addShape(pptx.ShapeType.roundRect, {
    x: 8.15,
    y: 1.65,
    w: 4.58,
    h: 2.35,
    rectRadius: 0.1,
    fill: { color: COLORS.bgCard },
    line: { color: COLORS.purplePrimary, width: 1.2 },
  });
  s10.addText('Why This Was a Huge Win', {
    x: 8.4,
    y: 1.85,
    w: 4.1,
    h: 0.35,
    fontSize: 14,
    bold: true,
    color: COLORS.white,
    fontFace: 'Segoe UI',
  });
  s10.addText(
    '• Caught a real race condition when clicking "Enrich" on multiple leads simultaneously.\n• Caught spec drift where code evolved faster than SPEC.md.\n• Proved the AI quality gate actually stops bad releases!',
    {
      x: 8.4,
      y: 2.28,
      w: 4.1,
      h: 1.55,
      fontSize: 11,
      color: COLORS.textLight,
      fontFace: 'Segoe UI',
    }
  );

  s10.addShape(pptx.ShapeType.roundRect, {
    x: 8.15,
    y: 4.25,
    w: 4.58,
    h: 2.4,
    rectRadius: 0.1,
    fill: { color: COLORS.bgCardAlt },
    line: { color: COLORS.greenPass, width: 1.2 },
  });
  s10.addText('Stage 2 Auto-Generated 10 Tests!', {
    x: 8.4,
    y: 4.45,
    w: 4.1,
    h: 0.35,
    fontSize: 14,
    bold: true,
    color: COLORS.greenPass,
    fontFace: 'Segoe UI',
  });
  s10.addText(
    '• Vertex AI wrote server/tests/vertex-generated.test.ts\n• 10 new Vitest + Supertest scenarios (malformed JWTs, 404s, case-insensitive duplicate prevention, CSV escaping)\n• All 19 tests across 3 suites ran & passed in 1.09s!',
    {
      x: 8.4,
      y: 4.88,
      w: 4.1,
      h: 1.6,
      fontSize: 11,
      color: COLORS.textLight,
      fontFace: 'Segoe UI',
    }
  );

  s10.addNotes(
    'Point out that this is not a canned screenshot—this is the actual output from Vertex AI reviewing our codebase. It caught a real concurrent write issue in storage.ts and noticed that our code switched to Google Places API while SPEC.md still mentioned Search Grounding.'
  );

  // =========================================================================
  // SLIDE 11: SPEED OPTIMIZATIONS & GOING LIVE ON CLOUD RUN
  // =========================================================================
  const s11 = pptx.addSlide();
  addMasterBackground(s11, pptx, 11);
  addSlideHeader(
    s11,
    'Act III • Production Deployment',
    'Making It Fast & Shipping Live to Google Cloud Run',
    'How we cut pipeline latency from 3+ minutes down to seconds for live demos.'
  );

  const perfCards = [
    {
      metric: '5x Faster AI Calls',
      title: 'thinkingBudget: 0 on Gemini 3 Flash',
      desc: 'Configured thinkingConfig: { thinkingBudget: 0 } in ai-review.ts & ai-generate-tests.ts so structured JSON responses return in ~5 seconds.',
    },
    {
      metric: '60s Faster Cloud Build',
      title: 'Pre-Built dist/ Slim Dockerfile',
      desc: 'Instead of compiling TypeScript & Vite twice (locally in Stage 3 and again in Cloud Build), Dockerfile packages the verified dist/ artifacts directly.',
    },
    {
      metric: 'HTTP 200 LIVE',
      title: 'Serverless Cloud Run in us-central1',
      desc: 'Revision aicrm-00001-5bn deployed with Vertex AI & Google Places env vars attached—scaling automatically from 0 to N.',
    },
  ];

  perfCards.forEach((pc, idx) => {
    const x = 0.6 + idx * 4.1;
    s11.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 1.7,
      w: 3.9,
      h: 3.1,
      rectRadius: 0.12,
      fill: { color: COLORS.bgCard },
      line: { color: COLORS.purpleBright, width: 1.3 },
    });
    s11.addText(pc.metric, {
      x: x + 0.25,
      y: 1.95,
      w: 3.4,
      h: 0.45,
      fontSize: 18,
      bold: true,
      color: COLORS.purpleLight,
      fontFace: 'Segoe UI',
    });
    s11.addText(pc.title, {
      x: x + 0.25,
      y: 2.5,
      w: 3.4,
      h: 0.4,
      fontSize: 13.5,
      bold: true,
      color: COLORS.white,
      fontFace: 'Segoe UI',
    });
    s11.addText(pc.desc, {
      x: x + 0.25,
      y: 3.0,
      w: 3.4,
      h: 1.6,
      fontSize: 11.2,
      color: COLORS.textLight,
      fontFace: 'Segoe UI',
    });
  });

  // Live URL Banner
  s11.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 5.15,
    w: 12.13,
    h: 1.5,
    rectRadius: 0.12,
    fill: { color: COLORS.bgCardAlt },
    line: { color: COLORS.greenPass, width: 1.5 },
  });
  s11.addText('LIVE PRODUCTION CLOUD RUN ENDPOINT', {
    x: 0.9,
    y: 5.35,
    w: 11.5,
    h: 0.3,
    fontSize: 10,
    bold: true,
    color: COLORS.greenPass,
    charSpacing: 1.5,
    fontFace: 'Segoe UI',
  });
  s11.addText('https://aicrm-<project-number>.us-central1.run.app', {
    x: 0.9,
    y: 5.7,
    w: 11.5,
    h: 0.45,
    fontSize: 22,
    bold: true,
    color: COLORS.white,
    fontFace: 'Consolas',
  });
  s11.addText('Command:  npm run vertex:deploy', {
    x: 0.9,
    y: 6.2,
    w: 11.5,
    h: 0.3,
    fontSize: 11.5,
    color: COLORS.purpleLight,
    fontFace: 'Consolas',
  });

  s11.addNotes(
    'Explain how the first deploy took ~3 minutes because Google Cloud had to provision Artifact Registry and build from scratch, and how we optimized both the Vertex AI calls and Dockerfile for fast iterations.'
  );

  // =========================================================================
  // SLIDE 12: LIVE DEMO & KEY TAKEAWAYS
  // =========================================================================
  const s12 = pptx.addSlide();
  addMasterBackground(s12, pptx, 12);
  addSlideHeader(
    s12,
    'Wrap-Up & Live Demo',
    'Key Takeaways: Spec → Swarm → Software',
    'Five lessons you can apply to your next project tomorrow morning.'
  );

  // Left: 5 Takeaways
  s12.addShape(pptx.ShapeType.roundRect, {
    x: 0.6,
    y: 1.65,
    w: 6.8,
    h: 5.0,
    rectRadius: 0.12,
    fill: { color: COLORS.bgCard },
    line: { color: COLORS.purplePrimary, width: 1.3 },
  });
  s12.addText(
    [
      { text: '1. Treat SPEC.md as Executable Code\n', options: { bold: true, color: COLORS.purpleLight } },
      { text: '   Define exact schemas, routes & invariants before launching agents.\n\n', options: { color: COLORS.textLight } },
      { text: '2. Separate Roles, Share Pointers (Not Whole Files)\n', options: { bold: true, color: COLORS.purpleLight } },
      { text: '   PO → Architect → 1 Persistent Builder → 1 Final QA Gate.\n\n', options: { color: COLORS.textLight } },
      { text: '3. Cap Scope & Iteration Loops\n', options: { bold: true, color: COLORS.purpleLight } },
      { text: '   Max 4 WPs, Blocker-only QA failures, and max 2 fix iterations.\n\n', options: { color: COLORS.textLight } },
      { text: '4. Know Your Vertex AI Auth & Endpoints\n', options: { bold: true, color: COLORS.purpleLight } },
      { text: '   Use gcloud auth application-default login & global / gemini-3-flash-preview.\n\n', options: { color: COLORS.textLight } },
      { text: '5. Let Vertex AI Guard the Release Door\n', options: { bold: true, color: COLORS.purpleLight } },
      { text: '   Automated AI Code Review + Test Generation catches bugs before Cloud Run.', options: { color: COLORS.textLight } },
    ],
    {
      x: 0.85,
      y: 1.9,
      w: 6.3,
      h: 4.5,
      fontSize: 11.8,
      valign: 'top',
      fontFace: 'Segoe UI',
    }
  );

  // Right: Live Demo Flow Box
  s12.addShape(pptx.ShapeType.roundRect, {
    x: 7.65,
    y: 1.65,
    w: 5.08,
    h: 5.0,
    rectRadius: 0.12,
    fill: { color: COLORS.bgCardAlt },
    line: { color: COLORS.purpleBright, width: 1.5 },
  });
  s12.addText('🎬  LIVE DEMO FLOW', {
    x: 7.95,
    y: 1.9,
    w: 4.5,
    h: 0.4,
    fontSize: 16,
    bold: true,
    color: COLORS.white,
    fontFace: 'Segoe UI',
  });
  s12.addText(
    `Step 1: Tour AICRM & SPEC.md
Show Places search, website enrichment & Gemini cold-call script generation.

Step 2: Run "npm run vertex:deploy"
Watch Stage 1 (Vertex AI Code Review) catch the CRITICAL race condition & spec drift and BLOCK the deploy!

Step 3: Fix Issues Live & Re-Deploy
Update SPEC.md & storage.ts → Watch Stages 1–4 pass green (19/19 tests) → Live on Google Cloud Run!`,
    {
      x: 7.95,
      y: 2.5,
      w: 4.5,
      h: 3.8,
      fontSize: 12,
      color: COLORS.textLight,
      valign: 'top',
      fontFace: 'Segoe UI',
    }
  );

  s12.addNotes(
    'Transition into the live demo! Show the audience AICRM running, run npm run vertex:deploy so they see Vertex AI block the deploy on the critical finding, then fix it live and deploy to Cloud Run.'
  );

  // Save to both AICRM and Presentations/GDG-Oct28-2026
  const outPath1 = path.resolve('c:\\Dev\\AICRM\\Spec-Swarm-Software-GDG-Oct28.pptx');
  const presDir = path.resolve('c:\\Dev\\Presentations\\GDG-Oct28-2026');
  fs.mkdirSync(presDir, { recursive: true });
  const outPath2 = path.join(presDir, 'Spec-Swarm-Software-GDG-Oct28.pptx');

  await pptx.writeFile({ fileName: outPath1 });
  fs.copyFileSync(outPath1, outPath2);

  console.log(`Saved presentation to:\n  1. ${outPath1}\n  2. ${outPath2}`);
}

buildDeck().catch((err) => {
  console.error('Failed to generate PowerPoint deck:', err);
  process.exit(1);
});
