import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Type, Schema } from '@google/genai';
import { createVertexOrGeminiClient } from './vertex-client.js';

interface ReviewFinding {
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  file: string;
  title: string;
  description: string;
  fixSuggestion: string;
}

interface SpecCheck {
  requirement: string;
  status: 'PASS' | 'PARTIAL' | 'MISSING';
  notes: string;
}

interface CodeReviewResult {
  summary: string;
  score: number;
  passed: boolean;
  findings: ReviewFinding[];
  specCompliance: SpecCheck[];
}

function collectSourceFiles(dir: string, rootDir: string, collected: string[] = []): string[] {
  if (!fs.existsSync(dir)) return collected;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, rootDir, collected);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      collected.push(path.relative(rootDir, fullPath));
    }
  }
  return collected;
}

function getGitDiffContext(rootDir: string): string {
  try {
    const diff = execSync('git diff HEAD', { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return diff.trim();
  } catch {
    return '';
  }
}

async function runCodeReview() {
  const rootDir = process.cwd();
  const isDryRun = process.argv.includes('--dry-run');

  console.log('\n========================================================');
  console.log('  Vertex AI Pre-Deployment Automated Code Review');
  console.log('========================================================\n');

  const specPath = path.join(rootDir, 'SPEC.md');
  const specContent = fs.existsSync(specPath) ? fs.readFileSync(specPath, 'utf8') : '';

  const serverFiles = collectSourceFiles(path.join(rootDir, 'server', 'src'), rootDir);
  const clientFiles = collectSourceFiles(path.join(rootDir, 'client', 'src'), rootDir);
  const allFiles = [...serverFiles, ...clientFiles];

  if (allFiles.length === 0) {
    console.error('No source files found in server/src or client/src.');
    process.exit(1);
  }

  console.log(`Collected ${allFiles.length} source files for review:`);
  for (const f of allFiles) {
    console.log(`  - ${f}`);
  }

  const fileBundles = allFiles
    .map((relPath) => {
      const content = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
      return `--- FILE: ${relPath} ---\n${content}\n`;
    })
    .join('\n');

  const gitDiff = getGitDiffContext(rootDir);

  let aiInfo;
  try {
    aiInfo = createVertexOrGeminiClient();
  } catch (err: any) {
    if (isDryRun) {
      console.log('\n[DRY-RUN] Credentials not configured yet. Skipping live Vertex AI call.');
      console.log(err.message);
      return;
    }
    console.error(`\n[ERROR] ${err.message}`);
    process.exit(1);
  }

  console.log(
    `\nConnecting to ${
      aiInfo.mode === 'vertex-ai'
        ? `Google Cloud Vertex AI (project: ${aiInfo.project}, location: ${aiInfo.location})`
        : 'Google Gemini API'
    } using model "${aiInfo.reviewModel}"...\n`
  );

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      summary: { type: Type.STRING, description: 'Executive summary of the code review' },
      score: { type: Type.INTEGER, description: 'Deployment readiness score from 0 to 100' },
      passed: {
        type: Type.BOOLEAN,
        description: 'True if there are zero CRITICAL findings and the codebase is safe to deploy',
      },
      findings: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            severity: { type: Type.STRING, enum: ['CRITICAL', 'WARNING', 'SUGGESTION'] },
            file: { type: Type.STRING },
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            fixSuggestion: { type: Type.STRING },
          },
          required: ['severity', 'file', 'title', 'description', 'fixSuggestion'],
        },
      },
      specCompliance: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            requirement: { type: Type.STRING },
            status: { type: Type.STRING, enum: ['PASS', 'PARTIAL', 'MISSING'] },
            notes: { type: Type.STRING },
          },
          required: ['requirement', 'status', 'notes'],
        },
      },
    },
    required: ['summary', 'score', 'passed', 'findings', 'specCompliance'],
  };

  const prompt = `You are a Principal Security & Full-Stack Software Engineer performing a pre-deployment code review on AICRM.

Review the codebase against the project specification (SPEC.md) for:
1. Security issues (authentication bypass, JWT handling, secret leakage, path traversal, injection).
2. Reliability & Data Integrity (atomic file writes to data/lists.json via .tmp rename, error handling, race conditions).
3. Specification Compliance (all REST endpoints, data models, CSV export, Gemini Search Grounding integration).
4. Frontend/Backend contract mismatches or TypeScript bugs.

Only mark an issue as CRITICAL if it causes data loss, a security vulnerability, a broken build, or violates a core requirement in SPEC.md.

=== PROJECT SPECIFICATION (SPEC.md) ===
${specContent}

${gitDiff ? `=== RECENT GIT DIFF ===\n${gitDiff}\n` : ''}
=== SOURCE FILES ===
${fileBundles}`;

  const response = await aiInfo.client.models.generateContent({
    model: aiInfo.reviewModel,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const rawText = response.text || '{}';
  const result: CodeReviewResult = JSON.parse(rawText);

  const reportsDir = path.join(rootDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, 'code-review.md');

  const mdLines: string[] = [
    '# Vertex AI Pre-Deployment Code Review Report',
    '',
    `- **Timestamp**: ${new Date().toISOString()}`,
    `- **Backend Mode**: ${aiInfo.mode === 'vertex-ai' ? `Vertex AI (${aiInfo.project} / ${aiInfo.location})` : 'Gemini API'}`,
    `- **Model**: \`${aiInfo.reviewModel}\``,
    `- **Readiness Score**: **${result.score} / 100**`,
    `- **Gate Status**: ${result.passed ? 'PASSED' : 'BLOCKED (Critical issues found)'}`,
    '',
    '## Executive Summary',
    result.summary,
    '',
    '## Spec Compliance Matrix',
    '| Requirement | Status | Notes |',
    '| :--- | :--- | :--- |',
    ...result.specCompliance.map((c) => `| ${c.requirement} | **${c.status}** | ${c.notes} |`),
    '',
    '## Findings',
  ];

  if (result.findings.length === 0) {
    mdLines.push('_No issues detected._');
  } else {
    for (const f of result.findings) {
      mdLines.push(
        `### [${f.severity}] ${f.title} (\`${f.file}\`)`,
        `- **Issue**: ${f.description}`,
        `- **Recommended Fix**: ${f.fixSuggestion}`,
        ''
      );
    }
  }

  fs.writeFileSync(reportPath, mdLines.join('\n'), 'utf8');

  console.log(`Readiness Score: ${result.score}/100 | Status: ${result.passed ? 'PASSED' : 'BLOCKED'}`);
  console.log(`Summary: ${result.summary}\n`);

  const criticalCount = result.findings.filter((f) => f.severity === 'CRITICAL').length;
  const warningCount = result.findings.filter((f) => f.severity === 'WARNING').length;
  const suggestionCount = result.findings.filter((f) => f.severity === 'SUGGESTION').length;

  console.log(
    `Findings: ${criticalCount} CRITICAL, ${warningCount} WARNING, ${suggestionCount} SUGGESTION`
  );
  for (const f of result.findings) {
    console.log(`  [${f.severity}] (${f.file}) ${f.title}`);
    console.log(`    -> ${f.fixSuggestion}`);
  }

  console.log(`\nFull report saved to: ${path.relative(rootDir, reportPath)}\n`);

  if (criticalCount > 0 || !result.passed) {
    console.error('Deployment blocked due to CRITICAL code review findings.');
    process.exit(1);
  }
}

runCodeReview().catch((err) => {
  console.error('Vertex AI Code Review failed:', err);
  process.exit(1);
});
