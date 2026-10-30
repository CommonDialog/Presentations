import fs from 'fs';
import path from 'path';
import { createVertexOrGeminiClient } from './vertex-client.js';

export async function diagnoseFailureWithVertex(
  stageName: string,
  commandOutput: string
): Promise<void> {
  const rootDir = process.cwd();
  console.log('\n========================================================');
  console.log(`  Vertex AI Problem Identifier (Failed Stage: ${stageName})`);
  console.log('========================================================\n');

  let aiInfo;
  try {
    aiInfo = createVertexOrGeminiClient();
  } catch (err: any) {
    console.error('Could not run Vertex AI diagnosis (credentials not configured):', err.message);
    return;
  }

  const appPath = path.join(rootDir, 'server', 'src', 'app.ts');
  const appCode = fs.existsSync(appPath) ? fs.readFileSync(appPath, 'utf8') : '';

  const prompt = `You are a Staff Site Reliability & Software Engineer diagnosing a pre-deployment failure in AICRM.

Failed Stage: "${stageName}"

=== FAILURE OUTPUT / STACK TRACE ===
${commandOutput.slice(-12000)}

=== server/src/app.ts ===
${appCode}

Provide a clear, actionable root-cause analysis with:
1. **Root Cause**: Why the test or build failed.
2. **Exact File & Location**: Which file and function caused the failure.
3. **Recommended Code Fix**: The exact code change required to fix the problem.`;

  try {
    const response = await aiInfo.client.models.generateContent({
      model: aiInfo.reviewModel,
      contents: prompt,
      config: { temperature: 0.1 },
    });

    const diagnosis = response.text || 'No diagnosis returned.';
    const reportsDir = path.join(rootDir, 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(reportsDir, 'problem-diagnosis.md');

    fs.writeFileSync(
      reportPath,
      `# Vertex AI Problem Diagnosis (${stageName})\n\n- **Timestamp**: ${new Date().toISOString()}\n\n${diagnosis}\n`,
      'utf8'
    );

    console.log(diagnosis);
    console.log(`\nSaved problem diagnosis report to: ${path.relative(rootDir, reportPath)}\n`);
  } catch (err: any) {
    console.error('Failed to call Vertex AI for problem diagnosis:', err.message);
  }
}
