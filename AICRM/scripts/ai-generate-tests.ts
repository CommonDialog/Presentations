import fs from 'fs';
import path from 'path';
import { Type, Schema } from '@google/genai';
import { createVertexOrGeminiClient } from './vertex-client.js';

interface GeneratedTestOutput {
  testFileContent: string;
  coveredScenarios: string[];
}

async function generateTests() {
  const rootDir = process.cwd();
  const isDryRun = process.argv.includes('--dry-run');

  console.log('\n========================================================');
  console.log('  Vertex AI Pre-Deployment Automated Test Generator');
  console.log('========================================================\n');

  const specPath = path.join(rootDir, 'SPEC.md');
  const appPath = path.join(rootDir, 'server', 'src', 'app.ts');
  const typesPath = path.join(rootDir, 'server', 'src', 'types.ts');
  const existingTestsPath = path.join(rootDir, 'server', 'tests', 'api.test.ts');

  if (!fs.existsSync(appPath)) {
    console.error('server/src/app.ts not found. Build the server files first.');
    process.exit(1);
  }

  let aiInfo;
  try {
    aiInfo = createVertexOrGeminiClient();
  } catch (err: any) {
    if (isDryRun) {
      console.log('[DRY-RUN] Credentials not configured yet. Skipping live Vertex AI test generation.');
      console.log(err.message);
      return;
    }
    console.error(`\n[ERROR] ${err.message}`);
    process.exit(1);
  }

  console.log(
    `Using ${
      aiInfo.mode === 'vertex-ai'
        ? `Vertex AI (${aiInfo.project} / ${aiInfo.location})`
        : 'Gemini API'
    } with model "${aiInfo.testGenModel}" to generate integration tests...\n`
  );

  const specContent = fs.existsSync(specPath) ? fs.readFileSync(specPath, 'utf8') : '';
  const appContent = fs.readFileSync(appPath, 'utf8');
  const typesContent = fs.existsSync(typesPath) ? fs.readFileSync(typesPath, 'utf8') : '';
  const existingTests = fs.existsSync(existingTestsPath)
    ? fs.readFileSync(existingTestsPath, 'utf8')
    : '';

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      coveredScenarios: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'List of test cases generated in this suite',
      },
      testFileContent: {
        type: Type.STRING,
        description: 'Complete runnable Vitest + Supertest TypeScript file content',
      },
    },
    required: ['coveredScenarios', 'testFileContent'],
  };

  const prompt = `You are a Staff QA Automation Engineer generating pre-deployment integration tests for AICRM using Vitest and Supertest.

Inspect SPEC.md, server/src/types.ts, server/src/app.ts, and the existing baseline test file server/tests/api.test.ts.
Generate a comprehensive, standalone Vitest test file that will be saved at "server/tests/vertex-generated.test.ts".

Requirements for the generated test file:
1. Import { describe, it, expect, beforeEach, afterAll } from 'vitest';
2. Import request from 'supertest';
3. Import { createApp } from '../src/app.js';
4. Use a temporary test data file path (e.g., path.join(os.tmpdir(), \`aicrm-vertex-test-\${Date.now()}.json\`)) passed to createApp({ dataFilePath, mockSearchLeads }) so it never mutates production data or requires live external network calls during unit testing.
5. Focus on edge cases, security boundaries, input validation, authorization headers, malformed JWT tokens, 404 handling for missing lists/contacts, duplicate prevention in append, and CSV escaping for commas/quotes.
6. Ensure every test is 100% deterministic and passes against the implementation in server/src/app.ts.

=== SPEC.md ===
${specContent}

=== server/src/types.ts ===
${typesContent}

=== server/src/app.ts ===
${appContent}

=== Existing Baseline Tests (server/tests/api.test.ts) ===
${existingTests}`;

  const response = await aiInfo.client.models.generateContent({
    model: aiInfo.testGenModel,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const parsed: GeneratedTestOutput = JSON.parse(response.text || '{}');
  if (!parsed.testFileContent) {
    throw new Error('Vertex AI returned empty test file content.');
  }

  const cleanCode = parsed.testFileContent
    .replace(/^```(?:typescript|ts)?\s*/i, '')
    .replace(/\s*```$/, '');

  const outPath = path.join(rootDir, 'server', 'tests', 'vertex-generated.test.ts');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, cleanCode, 'utf8');

  console.log(`Generated ${parsed.coveredScenarios.length} test scenarios:`);
  for (const scenario of parsed.coveredScenarios) {
    console.log(`  + ${scenario}`);
  }
  console.log(`\nSaved generated tests to: ${path.relative(rootDir, outPath)}\n`);
}

generateTests().catch((err) => {
  console.error('Vertex AI Test Generation failed:', err);
  process.exit(1);
});
