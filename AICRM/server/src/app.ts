import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import path from 'path';
import { Contact, ContactStatus, LeadList, LeadListSummary, RawLeadInput } from './types.js';
import { ListStorage } from './storage.js';
import {
  enrichContactData,
  generateContactCallScript,
  generateContactEmail,
  getAIStatus,
  searchLeadsWithGemini,
  updateRuntimeAISettings,
} from './gemini.js';
import { logger, requestLoggerMiddleware } from './logger.js';

export interface AppOptions {
  dataFilePath?: string;
  mockSearchLeads?: (criteria: string, excludeBusinessNames: string[]) => Promise<RawLeadInput[]>;
  mockGenerateEmail?: (
    contact: Contact,
    criteria: string
  ) => Promise<{ emailSubject: string; emailBody: string }>;
}

const VALID_STATUSES: ContactStatus[] = ['New', 'Contacted', 'Qualified', 'Disqualified'];

function escapeCsvField(value: string): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildContact(raw: RawLeadInput): Contact {
  const now = new Date().toISOString();
  const status: ContactStatus =
    raw.status && VALID_STATUSES.includes(raw.status) ? raw.status : 'New';

  return {
    id: crypto.randomUUID(),
    businessName: String(raw.businessName || '').trim(),
    contactName: String(raw.contactName || '').trim(),
    contactTitle: String(raw.contactTitle || '').trim(),
    phone: String(raw.phone || '').trim(),
    email: String(raw.email || '').trim(),
    website: String(raw.website || '').trim(),
    address: String(raw.address || '').trim(),
    description: String(raw.description || '').trim(),
    sourceUrl: String(raw.sourceUrl || '').trim(),
    placeId: raw.placeId ? String(raw.placeId).trim() : undefined,
    notes: String(raw.notes || '').trim(),
    callScript: raw.callScript ? String(raw.callScript).trim() : undefined,
    emailSubject: raw.emailSubject ? String(raw.emailSubject).trim() : undefined,
    emailBody: raw.emailBody ? String(raw.emailBody).trim() : undefined,
    status,
    createdAt: now,
    updatedAt: now,
  };
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(requestLoggerMiddleware);

  const defaultDataPath = path.resolve(process.cwd(), 'data', 'lists.json');
  const storage = new ListStorage(options.dataFilePath || defaultDataPath);
  const searchFn = options.mockSearchLeads || searchLeadsWithGemini;
  const generateEmailFn = options.mockGenerateEmail || generateContactEmail;

  const getJwtSecret = () => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    return secret;
  };
  const getAdminUser = () => process.env.ADMIN_USERNAME || '';
  const getAdminPass = () => process.env.ADMIN_PASSWORD || '';

  // Auth Middleware
  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (!token) {
      res.status(401).json({ error: 'Missing or invalid Authorization token' });
      return;
    }
    try {
      const payload = jwt.verify(token, getJwtSecret()) as { username: string };
      (req as any).user = payload;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };

  // POST /api/auth/login
  app.post('/api/auth/login', (req: Request, res: Response): void => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    const adminUser = getAdminUser();
    const adminPass = getAdminPass();
    if (!adminUser || !adminPass) {
      res.status(500).json({ error: 'Server authentication credentials are not configured' });
      return;
    }
    if (username !== adminUser || password !== adminPass) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const token = jwt.sign({ username }, getJwtSecret(), { expiresIn: '7d' });
    const aiStatus = getAIStatus();
    res.json({
      token,
      user: { username },
      username,
      ...aiStatus,
    });
  });

  // GET /api/auth/me
  app.get('/api/auth/me', requireAuth, (req: Request, res: Response): void => {
    const user = (req as any).user;
    const aiStatus = getAIStatus();
    res.json({
      user: { username: user.username },
      username: user.username,
      ...aiStatus,
    });
  });

  // POST /api/auth/settings
  app.post('/api/auth/settings', requireAuth, (req: Request, res: Response): void => {
    const { geminiApiKey, apiKey } = req.body || {};
    updateRuntimeAISettings({
      runtimeGeminiKey: geminiApiKey ?? apiKey,
    });
    const aiStatus = getAIStatus();
    res.json({
      ok: true,
      message: 'AI settings updated successfully',
      ...aiStatus,
    });
  });

  // GET /api/lists
  app.get('/api/lists', requireAuth, (_req: Request, res: Response): void => {
    const lists = storage.readLists();
    const summaries: LeadListSummary[] = lists.map((list) => ({
      id: list.id,
      name: list.name,
      criteria: list.criteria,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
      contactCount: list.contacts.length,
    }));
    res.json({ lists: summaries });
  });

  // GET /api/lists/:id
  app.get('/api/lists/:id', requireAuth, (req: Request, res: Response): void => {
    const lists = storage.readLists();
    const list = lists.find((l) => l.id === req.params.id);
    if (!list) {
      res.status(404).json({ error: 'List not found' });
      return;
    }
    res.json({ list });
  });

  // POST /api/lists/search
  app.post('/api/lists/search', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { name, criteria } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'List name is required' });
      return;
    }
    if (!criteria || typeof criteria !== 'string' || !criteria.trim()) {
      res.status(400).json({ error: 'Search criteria is required' });
      return;
    }

    try {
      const rawLeads = await searchFn(criteria.trim(), []);
      const contacts = rawLeads
        .filter((r) => r.businessName && r.businessName.trim().length > 0)
        .map(buildContact);

      const now = new Date().toISOString();
      const newList: LeadList = {
        id: crypto.randomUUID(),
        name: name.trim(),
        criteria: criteria.trim(),
        createdAt: now,
        updatedAt: now,
        contacts,
      };

      const lists = storage.readLists();
      lists.unshift(newList);
      storage.writeLists(lists);

      logger.info(`Saved new list "${newList.name}" with ${contacts.length} contacts`, {
        listId: newList.id,
      });

      res.status(201).json({ list: newList, addedCount: contacts.length });
    } catch (err: any) {
      logger.error(`Search failed for list "${name}" (${criteria})`, err);
      res.status(500).json({ error: err.message || 'AI search failed' });
    }
  });

  // POST /api/lists/:id/append
  app.post(
    '/api/lists/:id/append',
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const lists = storage.readLists();
      const listIndex = lists.findIndex((l) => l.id === req.params.id);
      if (listIndex === -1) {
        res.status(404).json({ error: 'List not found' });
        return;
      }

      const list = lists[listIndex];
      const criteriaToUse =
        typeof req.body?.criteria === 'string' && req.body.criteria.trim()
          ? req.body.criteria.trim()
          : list.criteria;

      const existingNames = list.contacts.map((c) => c.businessName);
      const existingLower = new Set(existingNames.map((n) => n.toLowerCase().trim()));

      try {
        const rawLeads = await searchFn(criteriaToUse, existingNames);
        const newContacts: Contact[] = [];

        for (const raw of rawLeads) {
          const bName = String(raw.businessName || '').trim();
          if (!bName) continue;
          const lower = bName.toLowerCase();
          if (existingLower.has(lower)) continue;
          existingLower.add(lower);
          newContacts.push(buildContact(raw));
        }

        list.criteria = criteriaToUse;
        list.contacts.push(...newContacts);
        list.updatedAt = new Date().toISOString();
        lists[listIndex] = list;
        storage.writeLists(lists);

        logger.info(`Appended ${newContacts.length} contacts to list "${list.name}"`, {
          listId: list.id,
          totalContacts: list.contacts.length,
        });

        res.json({ list, addedCount: newContacts.length });
      } catch (err: any) {
        logger.error(`Append search failed for list "${list.name}" (${list.id})`, err);
        res.status(500).json({ error: err.message || 'AI append search failed' });
      }
    }
  );

  // PATCH /api/lists/:id
  app.patch('/api/lists/:id', requireAuth, (req: Request, res: Response): void => {
    const { name, criteria } = req.body || {};
    const lists = storage.readLists();
    const index = lists.findIndex((l) => l.id === req.params.id);
    if (index === -1) {
      res.status(404).json({ error: 'List not found' });
      return;
    }

    const list = lists[index];
    if (typeof name === 'string' && name.trim()) {
      list.name = name.trim();
    }
    if (typeof criteria === 'string' && criteria.trim()) {
      list.criteria = criteria.trim();
    }
    list.updatedAt = new Date().toISOString();
    lists[index] = list;
    storage.writeLists(lists);

    res.json({ list });
  });

  // DELETE /api/lists/:id
  app.delete('/api/lists/:id', requireAuth, (req: Request, res: Response): void => {
    const lists = storage.readLists();
    const index = lists.findIndex((l) => l.id === req.params.id);
    if (index === -1) {
      res.status(404).json({ error: 'List not found' });
      return;
    }

    lists.splice(index, 1);
    storage.writeLists(lists);
    res.json({ ok: true, success: true });
  });

  // GET /api/lists/:id/export
  app.get('/api/lists/:id/export', requireAuth, (req: Request, res: Response): void => {
    const lists = storage.readLists();
    const list = lists.find((l) => l.id === req.params.id);
    if (!list) {
      res.status(404).json({ error: 'List not found' });
      return;
    }

    const headers = [
      'Business Name',
      'Contact Name',
      'Contact Title',
      'Phone',
      'Email',
      'Website',
      'Address',
      'Description',
      'Source URL',
      'Status',
      'Notes',
      'Created At',
      'Updated At',
    ];

    const rows = list.contacts.map((c) =>
      [
        c.businessName,
        c.contactName,
        c.contactTitle,
        c.phone,
        c.email,
        c.website,
        c.address,
        c.description,
        c.sourceUrl,
        c.status,
        c.notes,
        c.createdAt,
        c.updatedAt,
      ]
        .map(escapeCsvField)
        .join(',')
    );

    const csv = [headers.join(','), ...rows].join('\r\n');
    const safeName = list.name.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase() || 'leads';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
    res.send(csv);
  });

  // POST /api/lists/:id/contacts
  app.post('/api/lists/:id/contacts', requireAuth, (req: Request, res: Response): void => {
    const lists = storage.readLists();
    const index = lists.findIndex((l) => l.id === req.params.id);
    if (index === -1) {
      res.status(404).json({ error: 'List not found' });
      return;
    }

    const body = req.body || {};
    if (!body.businessName || typeof body.businessName !== 'string' || !body.businessName.trim()) {
      res.status(400).json({ error: 'businessName is required' });
      return;
    }

    const contact = buildContact(body);
    lists[index].contacts.unshift(contact);
    lists[index].updatedAt = new Date().toISOString();
    storage.writeLists(lists);

    res.status(201).json({ contact });
  });

  // PATCH /api/lists/:id/contacts/:contactId
  app.patch(
    '/api/lists/:id/contacts/:contactId',
    requireAuth,
    (req: Request, res: Response): void => {
      const lists = storage.readLists();
      const listIndex = lists.findIndex((l) => l.id === req.params.id);
      if (listIndex === -1) {
        res.status(404).json({ error: 'List not found' });
        return;
      }

      const list = lists[listIndex];
      const contactIndex = list.contacts.findIndex((c) => c.id === req.params.contactId);
      if (contactIndex === -1) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      const contact = list.contacts[contactIndex];
      const updates = req.body || {};

      const stringFields: Array<keyof Contact> = [
        'businessName',
        'contactName',
        'contactTitle',
        'phone',
        'email',
        'website',
        'address',
        'description',
        'sourceUrl',
        'notes',
        'callScript',
        'emailSubject',
        'emailBody',
        'enrichedAt',
      ];

      for (const field of stringFields) {
        if (typeof updates[field] === 'string') {
          (contact as any)[field] = updates[field];
        }
      }

      if (updates.status !== undefined) {
        if (!VALID_STATUSES.includes(updates.status)) {
          res.status(400).json({ error: 'Invalid contact status' });
          return;
        }
        contact.status = updates.status;
      }

      const now = new Date().toISOString();
      contact.updatedAt = now;
      list.updatedAt = now;

      list.contacts[contactIndex] = contact;
      lists[listIndex] = list;
      storage.writeLists(lists);

      res.json({ contact });
    }
  );

  // DELETE /api/lists/:id/contacts/:contactId
  app.delete(
    '/api/lists/:id/contacts/:contactId',
    requireAuth,
    (req: Request, res: Response): void => {
      const lists = storage.readLists();
      const listIndex = lists.findIndex((l) => l.id === req.params.id);
      if (listIndex === -1) {
        res.status(404).json({ error: 'List not found' });
        return;
      }

      const list = lists[listIndex];
      const contactIndex = list.contacts.findIndex((c) => c.id === req.params.contactId);
      if (contactIndex === -1) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      list.contacts.splice(contactIndex, 1);
      list.updatedAt = new Date().toISOString();
      lists[listIndex] = list;
      storage.writeLists(lists);

      res.json({ ok: true, success: true });
    }
  );

  // POST /api/lists/:id/contacts/:contactId/enrich - Pull contact details via scraper + targeted search
  app.post(
    '/api/lists/:id/contacts/:contactId/enrich',
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const lists = storage.readLists();
      const listIndex = lists.findIndex((l) => l.id === req.params.id);
      if (listIndex === -1) {
        res.status(404).json({ error: 'List not found' });
        return;
      }

      const list = lists[listIndex];
      const contactIndex = list.contacts.findIndex((c) => c.id === req.params.contactId);
      if (contactIndex === -1) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      const contact = list.contacts[contactIndex];
      try {
        const enriched = await enrichContactData(contact, list.criteria);
        const now = new Date().toISOString();
        const updatedContact: Contact = {
          ...contact,
          ...enriched,
          updatedAt: now,
        };

        list.contacts[contactIndex] = updatedContact;
        list.updatedAt = now;
        lists[listIndex] = list;
        storage.writeLists(lists);

        logger.info(`Enriched contact "${updatedContact.businessName}"`, {
          phone: updatedContact.phone,
          email: updatedContact.email,
        });

        res.json({ contact: updatedContact });
      } catch (err: any) {
        logger.error(`Failed to enrich contact "${contact.businessName}"`, err);
        res.status(500).json({ error: err.message || 'Failed to enrich contact' });
      }
    }
  );

  // POST /api/lists/:id/contacts/:contactId/script - Generate AI Call Script for contact
  app.post(
    '/api/lists/:id/contacts/:contactId/script',
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const lists = storage.readLists();
      const listIndex = lists.findIndex((l) => l.id === req.params.id);
      if (listIndex === -1) {
        res.status(404).json({ error: 'List not found' });
        return;
      }

      const list = lists[listIndex];
      const contactIndex = list.contacts.findIndex((c) => c.id === req.params.contactId);
      if (contactIndex === -1) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      const contact = list.contacts[contactIndex];
      try {
        const callScript = await generateContactCallScript(contact, list.criteria);
        const now = new Date().toISOString();
        contact.callScript = callScript;
        contact.updatedAt = now;
        list.updatedAt = now;
        list.contacts[contactIndex] = contact;
        lists[listIndex] = list;
        storage.writeLists(lists);

        logger.info(`Generated call script for "${contact.businessName}"`);
        res.json({ contact, callScript });
      } catch (err: any) {
        logger.error(`Failed to generate call script for "${contact.businessName}"`, err);
        res.status(500).json({ error: err.message || 'Failed to generate call script' });
      }
    }
  );

  // POST /api/lists/:id/contacts/:contactId/email - Generate AI Outreach Email for contact
  app.post(
    '/api/lists/:id/contacts/:contactId/email',
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const lists = storage.readLists();
      const listIndex = lists.findIndex((l) => l.id === req.params.id);
      if (listIndex === -1) {
        res.status(404).json({ error: 'List not found' });
        return;
      }

      const list = lists[listIndex];
      const contactIndex = list.contacts.findIndex((c) => c.id === req.params.contactId);
      if (contactIndex === -1) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      const contact = list.contacts[contactIndex];
      try {
        const { emailSubject, emailBody } = await generateEmailFn(contact, list.criteria);
        const now = new Date().toISOString();
        contact.emailSubject = emailSubject;
        contact.emailBody = emailBody;
        contact.updatedAt = now;
        list.updatedAt = now;
        list.contacts[contactIndex] = contact;
        lists[listIndex] = list;
        storage.writeLists(lists);

        logger.info(`Generated outreach email for "${contact.businessName}"`);
        res.json({ contact, emailSubject, emailBody });
      } catch (err: any) {
        logger.error(`Failed to generate outreach email for "${contact.businessName}"`, err);
        res.status(500).json({ error: err.message || 'Failed to generate outreach email' });
      }
    }
  );

  return app;
}
