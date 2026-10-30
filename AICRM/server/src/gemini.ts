import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { Contact, RawLeadInput } from './types.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../.env');

export interface AISettingsState {
  runtimeApiKey?: string;
}

const state: AISettingsState = {};

export function updateRuntimeAISettings(updates: {
  runtimeGeminiKey?: string;
  runtimeApiKey?: string;
}): void {
  const key = updates.runtimeGeminiKey ?? updates.runtimeApiKey;
  if (key !== undefined) {
    state.runtimeApiKey = key.trim() || undefined;
  }
  logger.info('Updated runtime Google API settings', getAIStatus());
}

function getActiveGeminiApiKey(): string {
  dotenv.config({ path: envPath });
  return (state.runtimeApiKey || process.env.GEMINI_API_KEY || '').trim();
}

function getActivePlacesApiKey(): string {
  dotenv.config({ path: envPath });
  return (
    process.env.GOOGLE_PLACES_NEW_API ||
    process.env.GOOGLE_PLACES_API_KEY ||
    state.runtimeApiKey ||
    process.env.GEMINI_API_KEY ||
    ''
  ).trim();
}

export function getAIStatus() {
  const activeKey = getActiveGeminiApiKey();
  const hasApiKey = Boolean(activeKey && activeKey !== 'your_gemini_api_key_here');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  return {
    hasApiKey,
    geminiConfigured: hasApiKey,
    mode: 'api-key' as const,
    model,
  };
}

interface GooglePlaceResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text?: string };
  editorialSummary?: { text?: string };
}

/**
 * STEP 1: Fast Google Places Text Search (No LLM call)
 * Pulls 20 business names, addresses, and Place IDs in <1 second.
 */
export async function searchLeadsWithGemini(
  criteria: string,
  excludeBusinessNames: string[] = []
): Promise<RawLeadInput[]> {
  const placesKey = getActivePlacesApiKey();
  if (!placesKey || placesKey === 'your_gemini_api_key_here') {
    throw new Error(
      'Google API Key is not configured. Please set GOOGLE_PLACES_API_KEY or GEMINI_API_KEY in c:\\Dev\\AICRM\\.env.'
    );
  }

  logger.info('Step 1: Querying Google Places API (New) for 20 businesses', {
    criteria,
    excludeCount: excludeBusinessNames.length,
  });

  const excludedSet = new Set(excludeBusinessNames.map((n) => n.toLowerCase().trim()));
  const collected: RawLeadInput[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 2 && collected.length < 20; page++) {
    const body: Record<string, unknown> = {
      textQuery: criteria,
      pageSize: 20,
    };
    if (pageToken) {
      body.pageToken = pageToken;
    }

    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': placesKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,nextPageToken',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error('Google Places Text Search failed', {
        status: res.status,
        body: errText,
      });
      throw new Error(`Google Places API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      places?: GooglePlaceResult[];
      nextPageToken?: string;
    };

    const places = data.places || [];
    logger.info(`Google Places returned ${places.length} places (page ${page + 1})`);

    for (const p of places) {
      const name = (p.displayName?.text || '').trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      if (excludedSet.has(lower)) continue;
      excludedSet.add(lower);

      collected.push({
        businessName: name,
        placeId: p.id || '',
        address: (p.formattedAddress || '').trim(),
        sourceUrl: (p.googleMapsUri || '').trim(),
        contactName: '',
        contactTitle: '',
        phone: '',
        email: '',
        website: '',
        description: '',
      });

      if (collected.length >= 20) break;
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return collected;
}

/**
 * Direct HTTP Website Scraper helper for Step 2 (Enrich)
 */
async function scrapeWebsiteForContactDetails(websiteUrl: string): Promise<{
  emails: string[];
  phones: string[];
  metaDescription: string;
}> {
  if (!websiteUrl) {
    return { emails: [], phones: [], metaDescription: '' };
  }

  const normalizedUrl =
    websiteUrl.startsWith('http://') || websiteUrl.startsWith('https://')
      ? websiteUrl
      : `https://${websiteUrl}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { emails: [], phones: [], metaDescription: '' };
    }

    const html = await res.text();

    const emailMatches =
      html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    const validEmails = Array.from(
      new Set(
        emailMatches
          .map((e) => e.toLowerCase())
          .filter(
            (e) =>
              !e.endsWith('.png') &&
              !e.endsWith('.jpg') &&
              !e.endsWith('.webp') &&
              !e.endsWith('.svg') &&
              !e.includes('example.com') &&
              !e.includes('sentry.io') &&
              !e.includes('wixpress.com')
          )
      )
    );

    const phoneMatches =
      html.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g) || [];
    const validPhones = Array.from(new Set(phoneMatches.map((p) => p.trim())));

    const metaMatch =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    const metaDescription = metaMatch?.[1]?.replace(/\s+/g, ' ').trim() || '';

    return {
      emails: validEmails,
      phones: validPhones,
      metaDescription,
    };
  } catch (err) {
    logger.debug(`Website scrape skipped for ${normalizedUrl}`, {
      reason: err instanceof Error ? err.message : String(err),
    });
    return { emails: [], phones: [], metaDescription: '' };
  }
}

/**
 * STEP 2: Enrich a Single Contact via Google Places Details + Website Scrape (No LLM call)
 */
export async function enrichContactData(
  contact: Contact,
  criteria: string
): Promise<Partial<Contact>> {
  const placesKey = getActivePlacesApiKey();
  if (!placesKey || placesKey === 'your_gemini_api_key_here') {
    throw new Error('Google API Key is not configured in .env.');
  }

  logger.info(`Step 2: Enriching contact "${contact.businessName}" via Google Places + Web Scrape`, {
    placeId: contact.placeId,
  });

  let placeDetails: GooglePlaceResult | null = null;

  if (contact.placeId) {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(contact.placeId)}`,
      {
        headers: {
          'X-Goog-Api-Key': placesKey,
          'X-Goog-FieldMask':
            'id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,googleMapsUri,primaryTypeDisplayName,editorialSummary',
        },
      }
    );

    if (res.ok) {
      placeDetails = (await res.json()) as GooglePlaceResult;
    } else {
      const errText = await res.text();
      logger.warn(`Google Places Details lookup failed (${res.status})`, { body: errText });
    }
  } else {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': placesKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,formattedAddress,nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.primaryTypeDisplayName,places.editorialSummary',
      },
      body: JSON.stringify({
        textQuery: `${contact.businessName} ${contact.address || criteria}`,
        pageSize: 1,
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { places?: GooglePlaceResult[] };
      placeDetails = data.places?.[0] || null;
    }
  }

  const website = (placeDetails?.websiteUri || contact.website || '').trim();
  const scraped = await scrapeWebsiteForContactDetails(website);

  const phone = (
    placeDetails?.nationalPhoneNumber ||
    placeDetails?.internationalPhoneNumber ||
    scraped.phones[0] ||
    contact.phone ||
    ''
  ).trim();

  const email = (scraped.emails[0] || contact.email || '').trim();
  const address = (placeDetails?.formattedAddress || contact.address || '').trim();
  const description = (
    placeDetails?.editorialSummary?.text ||
    scraped.metaDescription ||
    placeDetails?.primaryTypeDisplayName?.text ||
    contact.description ||
    ''
  ).trim();

  const sourceUrl = (placeDetails?.googleMapsUri || website || contact.sourceUrl || '').trim();

  return {
    placeId: placeDetails?.id || contact.placeId,
    phone,
    email,
    website,
    address,
    description,
    sourceUrl,
    enrichedAt: new Date().toISOString(),
  };
}

/**
 * STEP 3: AI Cold Call Script Generator (Uses Gemini AI)
 */
export async function generateContactCallScript(
  contact: Contact,
  criteria: string
): Promise<string> {
  const apiKey = getActiveGeminiApiKey();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured in .env.');
  }

  logger.info(`Step 3: Generating AI call script with Gemini for "${contact.businessName}"`);

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `Write a concise, natural, high-converting B2B cold call script for calling this lead:
- Business Name: ${contact.businessName}
- Contact Person: ${contact.contactName ? `${contact.contactName} (${contact.contactTitle || 'Decision Maker'})` : 'Owner / Decision Maker'}
- Phone: ${contact.phone || 'N/A'}
- Website: ${contact.website || 'N/A'}
- Location: ${contact.address || criteria}
- About Business: ${contact.description || criteria}
- Rep Notes: ${contact.notes || 'None'}

Structure the script clearly with:
1. **Opening & Pattern Interrupt** (tailored to ${contact.businessName})
2. **Value Hook** (referencing their services/market)
3. **2 Quick Discovery Questions**
4. **Common Objection Pivot** ("We're too busy right now / Already have someone")
5. **Call to Action / Next Step**`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.5,
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  });

  const script = (response.text || '').trim();
  if (!script) {
    throw new Error('Gemini returned an empty call script.');
  }
  return script;
}

/**
 * STEP 4: AI Outreach Email Generator (Uses Gemini AI)
 */
export async function generateContactEmail(
  contact: Contact,
  criteria: string
): Promise<{ emailSubject: string; emailBody: string }> {
  const apiKey = getActiveGeminiApiKey();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured in .env.');
  }

  logger.info(`Step 4: Generating AI outreach email with Gemini for "${contact.businessName}"`);

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `Write a concise, personalized, high-converting B2B cold outreach email for this lead:
- Business Name: ${contact.businessName}
- Contact Person: ${contact.contactName ? `${contact.contactName} (${contact.contactTitle || 'Decision Maker'})` : 'Owner / Decision Maker'}
- Email: ${contact.email || 'N/A'}
- Phone: ${contact.phone || 'N/A'}
- Website: ${contact.website || 'N/A'}
- Location: ${contact.address || criteria}
- About Business: ${contact.description || criteria}
- Search Criteria / Niche: ${criteria}
- Rep Notes: ${contact.notes || 'None'}

Return ONLY valid JSON with two string fields:
{
  "emailSubject": "Compelling, personalized subject line tailored to ${contact.businessName}",
  "emailBody": "Personalized multi-paragraph plain-text email body with greeting, tailored value hook, and clear low-friction call to action"
}`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.5,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  });

  const rawText = (response.text || '').trim();
  if (!rawText) {
    throw new Error('Gemini returned an empty email response.');
  }

  let emailSubject = '';
  let emailBody = '';

  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);
    emailSubject = typeof parsed.emailSubject === 'string' ? parsed.emailSubject.trim() : '';
    emailBody = typeof parsed.emailBody === 'string' ? parsed.emailBody.trim() : '';
  } catch {
    const subjectMatch = rawText.match(/^(?:Subject|emailSubject):\s*(.+)$/im);
    if (subjectMatch) {
      emailSubject = subjectMatch[1].trim();
      emailBody = rawText.replace(subjectMatch[0], '').trim();
    } else {
      emailSubject = `Quick question for ${contact.businessName}`;
      emailBody = rawText;
    }
  }

  if (!emailSubject || !emailBody) {
    throw new Error('Gemini returned an incomplete email draft.');
  }

  return { emailSubject, emailBody };
}

