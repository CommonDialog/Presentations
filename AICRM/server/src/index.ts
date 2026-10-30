import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import express from 'express';
import { fileURLToPath } from 'url';
import { createApp } from './app.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

const PORT = Number(process.env.PORT) || 3001;
const dataFilePath = path.resolve(__dirname, '../../data/lists.json');

const app = createApp({ dataFilePath });

const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  logger.info(`AICRM Server listening on http://localhost:${PORT}`, {
    logFile: logger.getLogFilePath(),
    dataFile: dataFilePath,
  });
});
