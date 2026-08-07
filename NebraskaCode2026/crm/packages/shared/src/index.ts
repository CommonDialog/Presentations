// @crm/shared — contracts shared between API and web.

export * from './domain.js';
export * from './auth.js';
export * from './crm.js';
export * from './pipeline.js';
export * from './activities.js';
export * from './knowledge.js';
export * from './active.js';
export * from './email.js';
export * from './calendar.js';
export * from './telephony.js';
export * from './projects.js';
export * from './workflows.js';
export * from './reports.js';
export * from './search.js';
export * from './customization.js';
export * from './integrations.js';
export * from './copilot.js';

export interface HealthResponse {
  status: 'ok';
  version: string;
  timestamp: string;
}
