/** Domain types for TTS jobs (skills.md: keep domain types in types files). */
import type { TtsJobStatus, JobErrorCode } from '@prisma/client';

export interface CreateJobResult {
  jobId: string;
  status: TtsJobStatus;
  message: string;
}

export interface JobStatusView {
  jobId: string;
  status: TtsJobStatus;
  audioUrl?: string;
  durationMs?: number;
  errorCode?: JobErrorCode;
  errorMessage?: string;
  createdAt: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
}

export interface JobListItem {
  jobId: string;
  status: TtsJobStatus;
  createdAt: string;
  completedAt?: string;
}

export interface JobListResult {
  items: JobListItem[];
  nextCursor: string | null;
}
