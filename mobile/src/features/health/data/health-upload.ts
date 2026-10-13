import { z } from 'zod';
import type { AppleImportBatch } from '@trainingai/shared/validation/apple-health-import';
import type { HealthConnectBatch } from '@trainingai/shared/validation/health-connect-import';

type Batch = AppleImportBatch | HealthConnectBatch;
export function isDeferredUpload(batch: Batch, now: number) {
  const rows = 'samples' in batch ? batch.samples : batch.records;
  return (
    !batch.deleted.length &&
    rows.length > 0 &&
    rows.every(
      (row) =>
        Date.parse(row.end) > now + 300000 ||
        ('modifiedAt' in row && Date.parse(row.modifiedAt) > now + 300000),
    )
  );
}
export function acknowledgedUpload<T extends Batch>(batch: T, reply: unknown): T | null {
  const ack = z
    .object({
      accepted: z.number(),
      deleted: z.number(),
      deferred: z.array(z.string()).default([]),
    })
    .parse(reply);
  const rows = 'samples' in batch ? batch.samples : batch.records;
  if (
    new Set(ack.deferred).size !== ack.deferred.length ||
    ack.deferred.some((id) => !rows.some((row) => row.id === id)) ||
    ack.accepted + ack.deferred.length !== rows.length ||
    ack.deleted !== batch.deleted.length
  )
    throw new Error('Health records were not confirmed');
  if (!ack.deferred.length) return null;
  return {
    ...batch,
    ...('samples' in batch
      ? { samples: batch.samples.filter((row) => ack.deferred.includes(row.id)) }
      : { records: batch.records.filter((row) => ack.deferred.includes(row.id)) }),
    deleted: [],
  } as T;
}
