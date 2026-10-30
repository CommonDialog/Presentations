import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface AIClientInfo {
  client: GoogleGenAI;
  mode: 'vertex-ai' | 'api-key';
  project?: string;
  location?: string;
  reviewModel: string;
  testGenModel: string;
}

export function createVertexOrGeminiClient(): AIClientInfo {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
  const vertexApiKey = process.env.VERTEX_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const useVertexEnv = process.env.USE_VERTEX_AI !== 'false';

  const reviewModel =
    process.env.VERTEX_REVIEW_MODEL || process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
  const testGenModel =
    process.env.VERTEX_TESTGEN_MODEL || process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

  const hasValidVertexApiKey = Boolean(
    vertexApiKey && vertexApiKey !== 'your_vertex_api_key_here'
  );
  const hasValidProject = Boolean(project && project !== 'your-gcp-project-id');
  const hasValidGeminiKey = Boolean(
    geminiApiKey && geminiApiKey !== 'your_gemini_api_key_here'
  );

  // 1. Vertex AI with Express Mode API Key (no gcloud CLI required)
  if (useVertexEnv && hasValidVertexApiKey) {
    const client = new GoogleGenAI({
      vertexai: true,
      apiKey: vertexApiKey,
    });
    return {
      client,
      mode: 'vertex-ai',
      project: project || 'vertex-express-mode',
      location,
      reviewModel,
      testGenModel,
    };
  }

  // 2. Vertex AI with GCP Project + Application Default Credentials / Service Account JSON
  if (useVertexEnv && hasValidProject) {
    const client = new GoogleGenAI({
      vertexai: true,
      project,
      location,
    });
    return {
      client,
      mode: 'vertex-ai',
      project,
      location,
      reviewModel,
      testGenModel,
    };
  }

  // 3. Standard Google AI Studio API Key fallback
  if (hasValidGeminiKey) {
    const client = new GoogleGenAI({ apiKey: geminiApiKey });
    return {
      client,
      mode: 'api-key',
      reviewModel,
      testGenModel,
    };
  }

  throw new Error(
    [
      'No Vertex AI or Gemini credentials configured.',
      'To use Vertex AI (Option A - Browser API Key, no CLI needed):',
      '  Set VERTEX_API_KEY=your-key in .env',
      'To use Vertex AI (Option B - GCP Project + Service Account / gcloud ADC):',
      '  Set GOOGLE_CLOUD_PROJECT=your-project-id in .env',
      'Or set GEMINI_API_KEY in .env to use Google AI Studio.',
    ].join('\n')
  );
}
