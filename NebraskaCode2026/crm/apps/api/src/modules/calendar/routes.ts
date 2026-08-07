import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { calendarEventSchema, createEventSchema, summarizeMeetingSchema } from '@crm/shared';
import { parse } from '../../lib/errors.js';
import {
  createCalendarEvent,
  getMeetingPrep,
  ingestCalendarEvent,
  listUpcomingMeetings,
  prepareMeeting,
  summarizeMeeting,
} from './service.js';

const idParam = z.object({ activityId: z.uuid() });

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  const write = { preHandler: [app.requirePermission('activities:write')] };
  const read = { preHandler: [app.requirePermission('activities:read')] };
  const aiUse = { preHandler: [app.requirePermission('ai:use')] };

  // Provider webhook stand-in (Google/Microsoft adapters call the same service).
  app.post('/calendar/events', write, async (req, reply) => {
    const result = await ingestCalendarEvent(app.db, req.auth!, parse(calendarEventSchema, req.body));
    return reply.code(result.duplicate ? 200 : 201).send(result);
  });

  app.post('/calendar/events/create', write, async (req, reply) => {
    const result = await createCalendarEvent(
      app.db,
      app.calendar,
      req.auth!,
      parse(createEventSchema, req.body),
    );
    return reply.code(201).send(result);
  });

  app.get('/calendar/upcoming', read, async (req) => ({
    meetings: await listUpcomingMeetings(app.db, req.auth!),
  }));

  app.post('/meetings/:activityId/prepare', aiUse, async (req) =>
    prepareMeeting(app.db, app.ai, req.auth!, parse(idParam, req.params).activityId),
  );

  app.get('/meetings/:activityId/prep', aiUse, async (req) => ({
    prep: await getMeetingPrep(app.db, req.auth!, parse(idParam, req.params).activityId),
  }));

  app.post('/meetings/:activityId/summarize', aiUse, async (req, reply) => {
    const { activityId } = parse(idParam, req.params);
    const { transcript } = parse(summarizeMeetingSchema, req.body);
    const result = await summarizeMeeting(app.db, app.ai, app.jobs, req.auth!, activityId, transcript);
    return reply.code(result.queued ? 202 : 200).send(result);
  });
};
