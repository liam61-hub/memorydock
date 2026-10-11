import 'dotenv/config';
import * as path from 'node:path';
import { configuredEmbedding, loadLocalSettings, userDataDir } from './local-config.js';

const embedding = configuredEmbedding();
const settings = loadLocalSettings();

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: parseInt(process.env.PORT || '40889', 10),

  embedding: {
    apiKey: embedding?.apiKey || '',
    model: embedding?.model || 'text-embedding-3-small',
    dim: embedding?.dim || 1536,
    maxRetries: parseInt(process.env.EMBEDDING_MAX_RETRIES || '3', 10),
    baseUrl: embedding?.baseUrl || '',
  },

  /** LLM for optional AI features (project import summaries). */
  llm: {
    apiKey: process.env.LLM_API_KEY || settings.llm?.apiKey || '',
    baseUrl: process.env.LLM_BASE_URL || settings.llm?.baseUrl || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || settings.llm?.model || 'gpt-4o-mini',
  },

  lancedb: {
    path: path.resolve(process.env.MEMORYDOCK_INDEX_PATH || path.join(userDataDir(), 'index')),
  },
} as const;
