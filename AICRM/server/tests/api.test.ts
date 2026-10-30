import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApp } from '../src/app.js';

describe('AICRM REST API Integration Suite', () => {
  const testDataPath = path.join(os.tmpdir(), `aicrm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  const mockSearchLeads = async (criteria: string, excludeBusinessNames: string[]) => {
    const candidates = [
      {
        businessName: 'KC Metro Plumbing',
        contactName: 'John Miller',
        contactTitle: 'Owner',
        phone: '816-555-0101',
        email: 'john@kcmetroplumbing.com',
        website: 'https://kcmetroplumbing.com',
        address: '123 Main St, Kansas City, MO',
        description: `Services for ${criteria}`,
        sourceUrl: 'https://kcmetroplumbing.com/about',
      },
      {
        businessName: 'Heartland Pipe & Drain, Co.',
        contactName: 'Sarah Connor',
        contactTitle: 'General Manager',
        phone: '913-555-0199',
        email: 'sarah@heartlandpipe.com',
        website: 'https://heartlandpipe.com',
        address: '450 Oak Ave, Overland Park, KS',
        description: 'Residential & commercial plumbing, "24/7 service"',
        sourceUrl: 'https://heartlandpipe.com',
      },
    ];
    const excludedSet = new Set(excludeBusinessNames.map((n) => n.toLowerCase()));
    return candidates.filter((c) => !excludedSet.has(c.businessName.toLowerCase()));
  };

  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeEach(async () => {
    process.env.ADMIN_USERNAME = 'test-admin';
    process.env.ADMIN_PASSWORD = 'test-password';
    process.env.JWT_SECRET = 'test-jwt-secret';

    if (fs.existsSync(testDataPath)) {
      fs.unlinkSync(testDataPath);
    }
    app = createApp({ dataFilePath: testDataPath, mockSearchLeads });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test-admin', password: 'test-password' });

    expect(loginRes.status).toBe(200);
    token = loginRes.body.token;
  });

  afterAll(() => {
    if (fs.existsSync(testDataPath)) {
      fs.unlinkSync(testDataPath);
    }
  });

  it('rejects unauthenticated requests to protected endpoints', async () => {
    const res = await request(app).get('/api/lists');
    expect(res.status).toBe(401);
  });

  it('verifies active session via GET /api/auth/me and updates settings via POST /api/auth/settings', async () => {
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.username).toBe('test-admin');

    const settingsRes = await request(app)
      .post('/api/auth/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        apiKey: 'test-runtime-key-123',
      });
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.body.ok).toBe(true);
    expect(settingsRes.body.hasApiKey).toBe(true);
  });

  it('creates a new lead list via AI search, appends non-duplicates, updates, and exports CSV', async () => {
    // 1. Search and create list
    const searchRes = await request(app)
      .post('/api/lists/search')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'KC Plumbers',
        criteria: 'plumbers within 25 miles of Kansas City',
      });

    expect(searchRes.status).toBe(201);
    expect(searchRes.body.list.name).toBe('KC Plumbers');
    expect(searchRes.body.list.contacts).toHaveLength(2);
    const listId = searchRes.body.list.id;

    // 2. Append should skip already-existing businesses
    const appendRes = await request(app)
      .post(`/api/lists/${listId}/append`)
      .set('Authorization', `Bearer ${token}`);
    expect(appendRes.status).toBe(200);
    expect(appendRes.body.list.contacts).toHaveLength(2);

    // 3. Manually add a contact
    const addContactRes = await request(app)
      .post(`/api/lists/${listId}/contacts`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'Apex Plumbing LLC',
        contactName: 'Mike Ross',
        phone: '816-555-0300',
        status: 'Qualified',
      });
    expect(addContactRes.status).toBe(201);
    expect(addContactRes.body.contact.businessName).toBe('Apex Plumbing LLC');
    const contactId = addContactRes.body.contact.id;

    // 4. Update contact status & notes
    const patchContactRes = await request(app)
      .patch(`/api/lists/${listId}/contacts/${contactId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: 'Contacted',
        notes: 'Left voicemail on Tuesday',
      });
    expect(patchContactRes.status).toBe(200);
    expect(patchContactRes.body.contact.status).toBe('Contacted');
    expect(patchContactRes.body.contact.notes).toBe('Left voicemail on Tuesday');

    // 5. Export CSV
    const csvRes = await request(app)
      .get(`/api/lists/${listId}/export`)
      .set('Authorization', `Bearer ${token}`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.text).toContain('KC Metro Plumbing');
    expect(csvRes.text).toContain('"Heartland Pipe & Drain, Co."');

    // 6. Delete contact and delete list
    const delContactRes = await request(app)
      .delete(`/api/lists/${listId}/contacts/${contactId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delContactRes.status).toBe(200);

    const delListRes = await request(app)
      .delete(`/api/lists/${listId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delListRes.status).toBe(200);
  });

  it('generates AI outreach email, persists emailSubject and emailBody, supports manual PATCH, and handles 404/500 errors', async () => {
    let shouldFailEmail = false;
    const emailApp = createApp({
      dataFilePath: testDataPath,
      mockSearchLeads,
      mockGenerateEmail: async (contact, criteria) => {
        if (shouldFailEmail) {
          throw new Error('Simulated Gemini email generation failure');
        }
        return {
          emailSubject: `Partnering with ${contact.businessName}`,
          emailBody: `Hi ${contact.contactName || 'there'},\n\nSaw your work in ${criteria} and wanted to reach out.`,
        };
      },
    });

    const loginRes = await request(emailApp)
      .post('/api/auth/login')
      .send({ username: 'test-admin', password: 'test-password' });
    const authToken = loginRes.body.token;

    // Create list with contacts
    const searchRes = await request(emailApp)
      .post('/api/lists/search')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'KC Plumbers Email Test',
        criteria: 'plumbers in Kansas City',
      });
    expect(searchRes.status).toBe(201);
    const listId = searchRes.body.list.id;
    const contactId = searchRes.body.list.contacts[0].id;

    // 1. 404 for invalid listId
    const notFoundListRes = await request(emailApp)
      .post(`/api/lists/non-existent-list/contacts/${contactId}/email`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(notFoundListRes.status).toBe(404);
    expect(notFoundListRes.body.error).toBe('List not found');

    // 2. 404 for invalid contactId
    const notFoundContactRes = await request(emailApp)
      .post(`/api/lists/${listId}/contacts/non-existent-contact/email`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(notFoundContactRes.status).toBe(404);
    expect(notFoundContactRes.body.error).toBe('Contact not found');

    // 3. 200 AI Email Generation & persistence
    const genRes = await request(emailApp)
      .post(`/api/lists/${listId}/contacts/${contactId}/email`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(genRes.status).toBe(200);
    expect(genRes.body.emailSubject).toBe('Partnering with KC Metro Plumbing');
    expect(genRes.body.emailBody).toContain('Hi John Miller');
    expect(genRes.body.contact.emailSubject).toBe('Partnering with KC Metro Plumbing');
    expect(genRes.body.contact.emailBody).toContain('Hi John Miller');

    // Verify persisted in storage via GET /api/lists/:id
    const getListRes = await request(emailApp)
      .get(`/api/lists/${listId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(getListRes.status).toBe(200);
    const savedContact = getListRes.body.list.contacts.find((c: any) => c.id === contactId);
    expect(savedContact.emailSubject).toBe('Partnering with KC Metro Plumbing');
    expect(savedContact.emailBody).toContain('Hi John Miller');

    // 4. Manual draft update via PATCH /api/lists/:id/contacts/:contactId
    const patchRes = await request(emailApp)
      .patch(`/api/lists/${listId}/contacts/${contactId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        emailSubject: 'Updated Subject Line',
        emailBody: 'Updated custom email body text.',
      });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.contact.emailSubject).toBe('Updated Subject Line');
    expect(patchRes.body.contact.emailBody).toBe('Updated custom email body text.');

    // 5. 500 error when AI generation fails
    shouldFailEmail = true;
    const failRes = await request(emailApp)
      .post(`/api/lists/${listId}/contacts/${contactId}/email`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(failRes.status).toBe(500);
    expect(failRes.body.error).toContain('Simulated Gemini email generation failure');
  });
});
