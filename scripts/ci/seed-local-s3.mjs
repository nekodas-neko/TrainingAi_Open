// #3933. Creates the bucket on the local S3 stand-in and puts a placeholder (a few bytes of text,
// not a model) at every key `checkModelAssets` reads: `<bucketPrefix>/<file>` for each name in
// `lib/oura-models/model-files.json`. Run by `scripts/ci/start-local-s3.sh`.
import { readFileSync } from 'node:fs'
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const { STORAGE_ENDPOINT, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY, STORAGE_BUCKET_NAME } = process.env
if (!STORAGE_ENDPOINT?.startsWith('http://localhost')) {
  console.error('seed-local-s3: STORAGE_ENDPOINT is not a local endpoint; refusing')
  process.exit(1)
}
const files = JSON.parse(readFileSync(new URL('../../lib/oura-models/model-files.json', import.meta.url), 'utf8'))
const client = new S3Client({
  endpoint: STORAGE_ENDPOINT,
  region: 'auto',
  forcePathStyle: true,
  credentials: { accessKeyId: STORAGE_ACCESS_KEY_ID, secretAccessKey: STORAGE_SECRET_ACCESS_KEY },
})
await client.send(new CreateBucketCommand({ Bucket: STORAGE_BUCKET_NAME }))
for (const file of files.required) {
  await client.send(
    new PutObjectCommand({
      Bucket: STORAGE_BUCKET_NAME,
      Key: `${files.bucketPrefix}/${file}`,
      Body: 'placeholder, not an ONNX model (route smoke stand-in, #3933)\n',
    }),
  )
}
console.error(`seeded ${files.required.length} placeholder file(s) under ${files.bucketPrefix}/`)
