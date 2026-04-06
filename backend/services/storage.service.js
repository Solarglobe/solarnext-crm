/**
 * CP-032 — Service S3 (Infomaniak Object Storage)
 * Stockage externe uniquement — aucune donnée locale
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const endpoint =
  process.env.S3_ENDPOINT || process.env.STORAGE_S3_ENDPOINT || "";
const region = process.env.S3_REGION || process.env.STORAGE_S3_REGION || "eu-west-1";
const bucket =
  process.env.S3_BUCKET || process.env.STORAGE_S3_BUCKET || "";
const accessKey =
  process.env.S3_ACCESS_KEY || process.env.STORAGE_S3_ACCESS_KEY || "";
const secretKey =
  process.env.S3_SECRET_KEY || process.env.STORAGE_S3_SECRET_KEY || "";

let s3Client = null;

function getS3Client() {
  if (!endpoint || !accessKey || !secretKey) {
    throw new Error("Configuration S3 manquante (S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY)");
  }
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint,
      region: region || "eu-west-1",
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey
      },
      forcePathStyle: true
    });
  }
  return s3Client;
}

/**
 * Upload un fichier vers S3
 * @param {Buffer} buffer - Contenu du fichier
 * @param {string} key - Clé de stockage (ex: orgId/entityType/entityId/uuid_filename)
 * @param {string} mimeType - Type MIME
 * @returns {Promise<string>} URL construite (endpoint + bucket + key)
 */
export async function uploadFile(buffer, key, mimeType) {
  const client = getS3Client();
  const b = bucket || process.env.STORAGE_S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET manquant");

  await client.send(
    new PutObjectCommand({
      Bucket: b,
      Key: key,
      Body: buffer,
      ContentType: mimeType || "application/octet-stream"
    })
  );

  const baseUrl = endpoint.replace(/\/$/, "");
  const url = `${baseUrl}/${b}/${key}`;
  return url;
}

/**
 * Supprime un fichier du storage S3
 * @param {string} key - Clé de stockage
 */
export async function deleteFile(key) {
  const client = getS3Client();
  const b = bucket || process.env.STORAGE_S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET manquant");

  await client.send(
    new DeleteObjectCommand({
      Bucket: b,
      Key: key
    })
  );
}
