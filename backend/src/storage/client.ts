import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { loadEnv } from "../config.js";

export interface StorageClient {
  upload(key: string, body: Buffer, contentType: string): Promise<void>;
  getSignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}

/**
 * Thin wrapper around Supabase Storage's S3-compatible API. Kept behind this
 * interface (rather than importing @aws-sdk/client-s3 directly in routes) so
 * integration tests can substitute an in-memory fake instead of hitting real
 * Supabase Storage in CI.
 */
export function createS3StorageClient(): StorageClient {
  const env = loadEnv();
  const s3 = new S3Client({
    endpoint: env.SUPABASE_S3_ENDPOINT,
    region: env.SUPABASE_S3_REGION,
    credentials: {
      accessKeyId: env.SUPABASE_ACCESS_KEY_ID,
      secretAccessKey: env.SUPABASE_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  const bucket = env.SUPABASE_BUCKET_NAME;

  return {
    async upload(key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async getSignedDownloadUrl(key, expiresInSeconds = 300) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds });
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
