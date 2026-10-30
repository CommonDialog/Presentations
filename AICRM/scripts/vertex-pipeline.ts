import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { diagnoseFailureWithVertex } from './ai-diagnose.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

interface StepResult {
  ok: boolean;
  output: string;
}

function resolveGcloudBinary(): string {
  const candidates = [
    'C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd',
    'C:\\Program Files\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd',
    path.join(
      process.env.LOCALAPPDATA || '',
      'Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd'
    ),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      return `"${c}"`;
    }
  }
  return 'gcloud';
}

function runStep(title: string, command: string, args: string[]): StepResult {
  console.log(`\n--------------------------------------------------------`);
  console.log(`▶ ${title}`);
  console.log(`  $ ${command} ${args.join(' ')}`);
  console.log(`--------------------------------------------------------\n`);

  const res = spawnSync(command, args, {
    cwd: process.cwd(),
    shell: true,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  const combinedOutput = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);

  return {
    ok: res.status === 0,
    output: combinedOutput,
  };
}

async function runVertexPipeline() {
  const shouldDeploy = process.argv.includes('--deploy');
  const forceContinue = process.argv.includes('--force');

  console.log('\n========================================================');
  console.log('  AICRM — 4-Stage Vertex AI Pre-Deploy & Release Pipeline');
  console.log('========================================================');

  // Stage 1: Review the Code
  const reviewRes = runStep('Stage 1/4: Vertex AI Code Review', 'npm', ['run', 'ai:review']);
  if (!reviewRes.ok) {
    if (forceContinue) {
      console.log(
        '\n⚠️  [--force enabled] Continuing past Stage 1 Code Review findings to test downstream stages...'
      );
    } else {
      await diagnoseFailureWithVertex('Stage 1: Vertex AI Code Review', reviewRes.output);
      process.exit(1);
    }
  }

  // Stage 2: Generate Unit & Integration Tests
  const testGenRes = runStep(
    'Stage 2/4: Vertex AI Automated Unit/Integration Test Generation',
    'npm',
    ['run', 'ai:generate-tests']
  );
  if (!testGenRes.ok) {
    await diagnoseFailureWithVertex('Stage 2: Vertex AI Test Generation', testGenRes.output);
    process.exit(1);
  }

  // Stage 3A: Run Tests & Identify Problems
  const testRunRes = runStep('Stage 3A/4: Run Test Suite & Identify Problems', 'npm', ['test']);
  if (!testRunRes.ok) {
    if (forceContinue) {
      console.log(
        '\n⚠️  [--force enabled] Continuing past test failures to test Cloud Run deployment...'
      );
    } else {
      await diagnoseFailureWithVertex('Stage 3A: Unit & Integration Test Suite', testRunRes.output);
      process.exit(1);
    }
  }

  // Stage 3B: Production Build Verification & Identify Problems
  const buildRes = runStep('Stage 3B/4: Production Build Verification', 'npm', ['run', 'build']);
  if (!buildRes.ok) {
    await diagnoseFailureWithVertex('Stage 3B: TypeScript & Vite Production Build', buildRes.output);
    process.exit(1);
  }

  console.log('\n✅ Stages 1-3 Completed.');

  // Stage 4: Deploy to Google Cloud Run (if --deploy is passed)
  if (shouldDeploy) {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    const region = process.env.CLOUD_RUN_REGION || 'us-central1';
    const vertexLocation = process.env.GOOGLE_CLOUD_LOCATION || 'global';
    const serviceName = process.env.CLOUD_RUN_SERVICE || 'aicrm';
    const placesKey = process.env.GOOGLE_PLACES_NEW_API || '';
    const geminiKey = process.env.GEMINI_API_KEY || '';

    if (!project || project === 'your-gcp-project-id') {
      console.error(
        '\n[ERROR] Cannot deploy to Cloud Run: Set GOOGLE_CLOUD_PROJECT in .env first.'
      );
      process.exit(1);
    }

    const gcloudBin = resolveGcloudBinary();
    const envVars = [
      `USE_VERTEX_AI=true`,
      `GOOGLE_CLOUD_PROJECT=${project}`,
      `GOOGLE_CLOUD_LOCATION=${vertexLocation}`,
      `GEMINI_MODEL=gemini-3-flash-preview`,
      placesKey ? `GOOGLE_PLACES_NEW_API=${placesKey}` : '',
      geminiKey ? `GEMINI_API_KEY=${geminiKey}` : '',
    ]
      .filter(Boolean)
      .join(',');

    const deployRes = runStep('Stage 4/4: Deploy AICRM to Google Cloud Run', gcloudBin, [
      'run',
      'deploy',
      serviceName,
      '--source',
      '.',
      '--project',
      project,
      '--region',
      region,
      '--allow-unauthenticated',
      '--quiet',
      `--set-env-vars="${envVars}"`,
    ]);

    if (!deployRes.ok) {
      await diagnoseFailureWithVertex('Stage 4: Cloud Run Deployment', deployRes.output);
      process.exit(1);
    }

    console.log('\n🚀 Stage 4 Complete: AICRM is deployed and live on Google Cloud Run!');
  } else {
    console.log(
      '\nℹ️  Ready for deployment! Run "npm run vertex:deploy" to deploy to Google Cloud Run.'
    );
  }
}

runVertexPipeline().catch((err) => {
  console.error('Vertex Pipeline failed:', err);
  process.exit(1);
});
