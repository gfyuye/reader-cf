import { Env } from "../types";

// 清理超过指定时间的未完成 multipart upload 碎片，避免 R2 存储空间泄漏
export async function cleanupStaleMultipartUploads(env: Env): Promise<{ aborted: number; errors: number }> {
  const now = Math.floor(Date.now() / 1000);
  const olderThan = 24 * 3600; // 24 小时前的未完成上传视为碎片

  const bucket = env.BUCKET as any;
  let aborted = 0;
  let errors = 0;
  let cursor: string | undefined;

  while (true) {
    const listed = await bucket.listMultipartUploads({ cursor });
    for (const upload of listed.uploads || []) {
      const age = now - Math.floor(upload.initiated / 1000);
      if (age > olderThan) {
        try {
          await bucket.abortMultipartUpload(upload.key, upload.uploadId);
          aborted++;
        } catch {
          errors++;
        }
      }
    }
    if (!listed.truncated) break;
    cursor = listed.cursor as string | undefined;
  }

  return { aborted, errors };
}
