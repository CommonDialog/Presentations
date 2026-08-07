import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  customFieldCreateSchema,
  customFieldUpdateSchema,
  customizableEntityTypes,
  layoutUpsertSchema,
  recordTypeCreateSchema,
  recordTypeUpdateSchema,
} from '@crm/shared';
import { parse } from '../../lib/errors.js';
import {
  createCustomField,
  createRecordType,
  deleteCustomField,
  deleteLayout,
  deleteRecordType,
  getBundle,
  listCustomFields,
  listLayouts,
  listRecordTypes,
  updateCustomField,
  updateRecordType,
  upsertLayout,
} from './service.js';

const idParam = z.object({ id: z.uuid() });
const entityQuery = z.object({
  entityType: z.enum(customizableEntityTypes).optional(),
  includeInactive: z.coerce.boolean().default(false),
});
const bundleQuery = z.object({
  entityType: z.enum(customizableEntityTypes),
  recordType: z.string().optional(),
});

export const customizationRoutes: FastifyPluginAsync = async (app) => {
  const manage = { preHandler: [app.requirePermission('settings:manage')] };
  const authed = { preHandler: [app.authenticate] };

  // Record pages read one bundle: fields + record types + resolved layout.
  app.get('/customization/bundle', authed, async (req) => {
    const { entityType, recordType } = parse(bundleQuery, req.query);
    return getBundle(app.db, req.auth!, entityType, recordType);
  });

  app.get('/customization/fields', authed, async (req) => {
    const { entityType, includeInactive } = parse(entityQuery, req.query);
    return { fields: await listCustomFields(app.db, req.auth!, entityType, includeInactive) };
  });

  app.post('/customization/fields', manage, async (req, reply) => {
    const field = await createCustomField(app.db, req.auth!, parse(customFieldCreateSchema, req.body));
    return reply.code(201).send(field);
  });

  app.patch('/customization/fields/:id', manage, async (req) =>
    updateCustomField(
      app.db,
      req.auth!,
      parse(idParam, req.params).id,
      parse(customFieldUpdateSchema, req.body),
    ),
  );

  app.delete('/customization/fields/:id', manage, async (req, reply) => {
    await deleteCustomField(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.get('/customization/record-types', authed, async (req) => {
    const { entityType } = parse(entityQuery, req.query);
    return { recordTypes: await listRecordTypes(app.db, req.auth!, entityType) };
  });

  app.post('/customization/record-types', manage, async (req, reply) => {
    const recordType = await createRecordType(app.db, req.auth!, parse(recordTypeCreateSchema, req.body));
    return reply.code(201).send(recordType);
  });

  app.patch('/customization/record-types/:id', manage, async (req) =>
    updateRecordType(
      app.db,
      req.auth!,
      parse(idParam, req.params).id,
      parse(recordTypeUpdateSchema, req.body),
    ),
  );

  app.delete('/customization/record-types/:id', manage, async (req, reply) => {
    await deleteRecordType(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  app.get('/customization/layouts', manage, async (req) => {
    const { entityType } = parse(entityQuery, req.query);
    return { layouts: await listLayouts(app.db, req.auth!, entityType) };
  });

  app.put('/customization/layouts', manage, async (req) =>
    upsertLayout(app.db, req.auth!, parse(layoutUpsertSchema, req.body)),
  );

  app.delete('/customization/layouts/:id', manage, async (req, reply) => {
    await deleteLayout(app.db, req.auth!, parse(idParam, req.params).id);
    return reply.code(204).send();
  });
};
