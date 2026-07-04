# 2. Backend Verification Plan

## 1. Project Setup Verification

Check:

```text
- API starts successfully.
- Worker starts successfully.
- Postgres container runs.
- Redis container runs.
- Environment variables load correctly.
- Docker Compose can start the full backend stack.
```

Validation commands:

```text
docker compose up
GET /health
GET /health/dependencies
```

Expected result:

```text
API status = healthy
Postgres = ok
Redis = ok
```

## 2. Authentication Verification

Test cases:

```text
1. Request without API key.
2. Request with invalid API key.
3. Request with valid API key.
4. User A tries to access User B job.
```

Expected result:

```text
Missing key → 401
Invalid key → 401
Valid key → request accepted
Cross-user access → 403
```

## 3. Job Creation Verification

Test cases:

```text
1. Submit valid Bengali text.
2. Submit empty text.
3. Submit oversized text.
4. Submit invalid payload.
5. Submit too many requests.
```

Expected result:

```text
Valid text → job created in Postgres and Redis
Empty text → 400
Oversized text → 413
Invalid payload → 400
Too many requests → 429
```

Verify database:

```sql
SELECT * FROM tts_jobs ORDER BY created_at DESC;
```

Expected:

```text
New job exists with status = queued.
```

## 4. Queue Verification

Check:

```text
- Job is pushed to BullMQ.
- Worker picks the job.
- Job status changes from queued to processing.
- Worker concurrency limit is respected.
```

Expected result:

```text
API responds immediately.
Worker processes job in background.
Multiple requests do not block API.
```

## 5. Model Server Integration Verification

Test model server directly:

```http
GET /health
POST /v1/tts/generate
```

Expected:

```text
Health endpoint returns ok.
Generate endpoint returns playable WAV audio.
Invalid internal token returns 401/403.
Invalid text returns 400.
Model failure returns 500.
```

Then test through worker:

```text
Submit job from API.
Worker calls model server.
Audio is generated and stored.
```

## 6. Audio Storage Verification

Test cases:

```text
1. Completed job has audio_path/audio_url.
2. Audio file exists in storage.
3. Audio file is playable.
4. User can download own audio.
5. User cannot download another user's audio.
```

Expected result:

```text
Own audio → 200
Other user audio → 403
Missing audio → 404
```

## 7. Job Status Verification

Test endpoint:

```http
GET /v1/tts/jobs/:jobId
```

Expected states:

```text
queued
processing
completed
failed
retrying
timeout
```

Validation:

```text
- Status in API matches Postgres.
- Completed job includes audio URL.
- Failed job includes safe error message.
```

## 8. Retry Verification

Simulate:

```text
- Model server down
- Model server timeout
- Model server returns 500
- Network error
```

Expected:

```text
retry_count increases.
Job status becomes retrying.
Job is requeued with backoff.
After max retries, job becomes failed.
Failure email is sent.
Incident alert is triggered if threshold is exceeded.
```

Check Postgres:

```sql
SELECT status, retry_count, error_message FROM tts_jobs WHERE id = '<job_id>';
```

## 9. Redis Disaster Recovery Verification

Scenario 1:

```text
1. Create job in Postgres.
2. Push to Redis.
3. Stop Redis.
4. Restart Redis.
5. Run recovery service.
```

Expected:

```text
Queued/stale jobs are re-enqueued.
Worker resumes processing.
No completed job is duplicated.
```

Scenario 2:

```text
Postgres says completed but Redis has old job.
```

Expected:

```text
Worker skips completed job.
No duplicate audio generation.
```

Scenario 3:

```text
Postgres says processing for longer than timeout.
```

Expected:

```text
Recovery service marks it retrying and re-enqueues it.
```

## 10. Incident Alert Verification

Simulate dependency failures:

```text
- Stop Redis
- Stop Postgres
- Stop model server
- Break email provider config
- Break storage path
```

Expected:

```text
/health/dependencies returns degraded.
Structured error is logged.
Incident alert is sent.
Service refuses new jobs when critical dependency is unavailable.
```

## 11. Email Notification Verification

Test cases:

```text
1. Job completed successfully.
2. Job failed after retries.
3. Email provider unavailable.
```

Expected:

```text
Success email contains job ID and download link.
Failure email contains job ID and failure message.
Email failure creates alert/log event but does not corrupt job status.
```

## 12. Rate Limiting and Backpressure Verification

Test:

```text
- Send many requests from same API key.
- Submit more than allowed pending jobs.
- Fill global queue.
```

Expected:

```text
Same user too many requests → 429
Too many pending jobs → 429
Queue full → 503
Other users are not affected by one abusive user
```

## 13. Multi-User Isolation Verification

Create:

```text
User A
User B
```

Test:

```text
- User A creates job.
- User B tries to read User A job.
- User B tries to download User A audio.
- User B tries to list jobs.
```

Expected:

```text
User B cannot see or download User A data.
Job list only returns authenticated user's own jobs.
```

## 14. Load Test Verification

Run simple load test:

```text
- 10 users
- 100 job submissions
- Worker concurrency = 1
```

Expected:

```text
API remains responsive.
Jobs are queued.
Worker processes gradually.
No API timeout during job creation.
Queue backlog is visible.
Rate limits work.
```

Useful tools:

```text
k6
autocannon
Artillery
```

## 15. Final Acceptance Checklist

The backend is complete when:

```text
- API accepts Bengali text and returns job ID immediately.
- Job is stored in Postgres.
- Job is pushed to Redis/BullMQ.
- Worker processes job asynchronously.
- Worker calls separate model server.
- Audio is generated and downloadable.
- Users cannot access each other’s jobs.
- Redis crash recovery works.
- Retry logic works.
- Failure handling works.
- Email notification works.
- Incident alerting works.
- Health checks work.
- README explains setup and architecture clearly.
```
