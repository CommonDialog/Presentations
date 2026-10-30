import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApp } from '../src/app.js';
import { RawLeadInput } from '../src/types.js';

describe('AICRM Vertex-Generated Integration Tests', () => {
  const testDataPath = path.join(os.tmpdir(), `aicrm-vertex-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  let app: any;
  let authToken: string;

  const mockSearchLeads = async (criteria: string, excludeBusinessNames: string[]): Promise<RawLeadInput[]> => {
    const results: RawLeadInput[] = [
      { businessName: 'Unique Plumbing', contactName: 'Alice', status: 'New' },
      { businessName: 'Duplicate Corp', contactName: 'Bob', status: 'New' }
    ];
    const excluded = new Set(excludeBusinessNames.map(n => n.toLowerCase().trim()));
    return results.filter(r => !excluded.has((r.businessName || '').toLowerCase().trim()));
  };

  beforeEach(async () => {
    process.env.ADMIN_USERNAME = 'test-admin';
    process.env.ADMIN_PASSWORD = 'test-password';
    process.env.JWT_SECRET = 'test-jwt-secret';

    if (fs.existsSync(testDataPath)) fs.unlinkSync(testDataPath);
    app = createApp({ dataFilePath: testDataPath, mockSearchLeads });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test-admin', password: 'test-password' });
    authToken = loginRes.body.token;
  });

  afterAll(() => {
    if (fs.existsSync(testDataPath)) fs.unlinkSync(testDataPath);
  });

  describe('Security & Authentication', () => {
    it('should return 401 for missing token', async () => {
      const res = await request(app).get('/api/lists');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Missing or invalid/);
    });

    it('should return 401 for malformed token', async () => {
      const res = await request(app)
        .get('/api/lists')
        .set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid or expired/);
    });

    it('should return 401 for incorrect login credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'wrong-password' });
      expect(res.status).toBe(401);
    });

    it('should return 400 for missing login fields', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin' });
      expect(res.status).toBe(400);
    });
  });

  describe('Input Validation & Edge Cases', () => {
    it('should return 400 when creating a list without a name', async () => {
      const res = await request(app)
        .post('/api/lists/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ criteria: 'some criteria' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('name is required');
    });

    it('should return 404 for a non-existent list ID', async () => {
      const res = await request(app)
        .get('/api/lists/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(404);
    });

    it('should return 400 for invalid contact status', async () => {
      const searchRes = await request(app)
        .post('/api/lists/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Test List', criteria: 'Test Criteria' });
      
      const listId = searchRes.body.list.id;
      const contactId = searchRes.body.list.contacts[0].id;

      const res = await request(app)
        .patch(`/api/lists/${listId}/contacts/${contactId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'NotAStatus' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid contact status');
    });
  });

  describe('Business Logic: Append & Duplicates', () => {
    it('should not append contacts that already exist in the list (case-insensitive)', async () => {
      const searchRes = await request(app)
        .post('/api/lists/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Duplicate Test', criteria: 'test' });
      
      const listId = searchRes.body.list.id;
      expect(searchRes.body.addedCount).toBe(2);

      // Append again. Mock returns 'Unique Plumbing' and 'Duplicate Corp'.
      // Both already exist, so addedCount should be 0.
      const appendRes = await request(app)
        .post(`/api/lists/${listId}/append`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ criteria: 'test' });
      
      expect(appendRes.status).toBe(200);
      expect(appendRes.body.addedCount).toBe(0);
      expect(appendRes.body.list.contacts.length).toBe(2);
    });
  });

  describe('CSV Export & Escaping', () => {
    it('should correctly escape special characters in CSV', async () => {
      const searchRes = await request(app)
        .post('/api/lists/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'CSV Test', criteria: 'test' });
      
      const listId = searchRes.body.list.id;
      
      // Add a contact with tricky characters
      await request(app)
        .post(`/api/lists/${listId}/contacts`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          businessName: 'Comma, "Quote" & Newline\nInc',
          contactName: 'Tester'
        });

      const res = await request(app)
        .get(`/api/lists/${listId}/export`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain('text/csv');
      // Expected escaped: "Comma, ""Quote"" & Newline\nInc"
      expect(res.text).toContain('"Comma, ""Quote"" & Newline\nInc"');
    });
  });

  describe('Settings', () => {
    it('should update runtime AI settings', async () => {
      const res = await request(app)
        .post('/api/auth/settings')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ geminiApiKey: 'new-key-123' });
      
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });
});