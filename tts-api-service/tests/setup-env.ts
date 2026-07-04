/** Provide the minimum valid env so importing src/config/env.ts doesn't exit. */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://tts:tts@localhost:5432/tts?schema=public';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.MODEL_SERVER_URL = 'http://localhost:8000';
process.env.MODEL_SERVER_INTERNAL_TOKEN = 'test-token';
process.env.S3_ENDPOINT = 'http://localhost:9000';
process.env.S3_BUCKET = 'tts-audio';
process.env.S3_ACCESS_KEY_ID = 'minioadmin';
process.env.S3_SECRET_ACCESS_KEY = 'minioadmin';
process.env.SMTP_HOST = 'localhost';
process.env.API_KEY_PEPPER = 'test-pepper';
process.env.MAX_TEXT_LENGTH = '20';
process.env.MAX_PENDING_JOBS_PER_USER = '5';
process.env.GLOBAL_QUEUE_MAX = '100';
