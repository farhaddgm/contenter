import { useEffect, useRef } from 'react';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type { AiJob, AiJobStatus, AiJobType, Paginated } from '@contenter/shared';
import { api } from '@/lib/api-client';
import { notify } from '@/stores/notifications';
import { translate } from '@/i18n';
import { useUi } from '@/stores/ui';

const ACTIVE: AiJobStatus[] = ['QUEUED', 'RUNNING'];
export const isJobActive = (s?: AiJobStatus) => !!s && ACTIVE.includes(s);

export const jobKeys = {
  all: ['jobs'] as const,
  one: (id: string) => ['jobs', id] as const,
  list: (params: object) => ['jobs', 'list', params] as const,
};

export function useJob(jobId: string | null | undefined) {
  return useQuery({
    queryKey: jobKeys.one(jobId ?? ''),
    queryFn: () => api.get<AiJob>(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (isJobActive(q.state.data?.status) || !q.state.data ? 1500 : false),
    staleTime: 0,
  });
}

/**
 * Polls a job and, when it finishes, invalidates the given query keys and notifies.
 * "AI decides, code executes": the UI only waits for the job; domain data is refetched afterwards.
 */
export function useTrackJob(
  jobId: string | null | undefined,
  {
    invalidate = [],
    onDone,
    silent,
  }: { invalidate?: QueryKey[]; onDone?: (job: AiJob) => void; silent?: boolean } = {},
) {
  const qc = useQueryClient();
  const job = useJob(jobId);
  const handled = useRef<string | null>(null);
  const status = job.data?.status;

  useEffect(() => {
    if (!job.data || isJobActive(status) || handled.current === job.data.id) return;
    handled.current = job.data.id;
    invalidate.forEach((key) => void qc.invalidateQueries({ queryKey: key }));
    const lang = useUi.getState().lang;
    if (!silent) {
      if (status === 'SUCCEEDED')
        notify.success(
          translate(lang, 'jobs.done'),
          translate(lang, `enums.jobType.${job.data.type}`),
        );
      if (status === 'FAILED')
        notify.error(translate(lang, 'jobs.jobFailed'), job.data.error ?? undefined);
    }
    onDone?.(job.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, job.data?.id]);

  return { job: job.data, isRunning: !!jobId && (isJobActive(status) || !job.data) };
}

// ---------- admin ----------

export interface JobListParams {
  page: number;
  pageSize?: number;
  status?: AiJobStatus | '';
  type?: AiJobType | '';
  q?: string;
}

export function useJobs(params: JobListParams) {
  return useQuery({
    queryKey: jobKeys.list(params),
    queryFn: () => api.get<Paginated<AiJob>>('/admin/jobs', { ...params }),
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });
}

export function useQueueStats() {
  return useQuery({
    queryKey: ['jobs', 'queue'],
    queryFn: () => api.get<Record<string, number | string>>('/admin/jobs/queue'),
    refetchInterval: 5000,
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ jobId: string }>(`/admin/jobs/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.all }),
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ jobId: string }>(`/admin/jobs/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.all }),
  });
}
