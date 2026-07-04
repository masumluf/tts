/**
 * Audio object storage (MinIO / S3-compatible) via AWS SDK v3.
 * Infra-only (skills.md): no business rules, no ownership checks.
 */
import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';

const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

function audioKey(jobId: string): string {
  return `audio/${jobId}.wav`;
}

export const storageClient = {
  audioKey,

  async putAudio(jobId: string, body: Buffer): Promise<string> {
    const key = audioKey(jobId);
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: 'audio/wav',
      }),
    );
    return key;
  },

  /** Time-limited download URL (expiry from AUDIO_URL_EXPIRY_SECONDS). */
  async getPresignedUrl(key: string): Promise<string> {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
      expiresIn: env.AUDIO_URL_EXPIRY_SECONDS,
    });
  },

  async getObjectStream(key: string): Promise<Readable> {
    const result = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    const body = result.Body;
    if (!(body instanceof Readable)) {
      throw new Error('Unexpected S3 body type (expected a readable stream).');
    }
    return body;
  },

  async objectExists(key: string): Promise<boolean> {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  },

  /** Health probe: confirms the bucket is reachable. */
  async healthCheck(): Promise<void> {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  },
};

export type StorageClient = typeof storageClient;
