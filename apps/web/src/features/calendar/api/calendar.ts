import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CalendarResponse,
  Content,
  PublishContentInput,
  ScheduleContentInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';

export const calendarKeys = {
  all: ['calendar'] as const,
  range: (p: object) => ['calendar', p] as const,
};

/** Planned and published contents inside [from, to), plus the approved ones nobody planned yet. */
export function useCalendar(params: {
  from: string;
  to: string;
  topicId?: string;
  campaignId?: string;
  tagId?: string;
}) {
  return useQuery({
    queryKey: calendarKeys.range(params),
    queryFn: () => api.get<CalendarResponse>('/calendar', { ...params }),
    placeholderData: keepPreviousData,
  });
}

type PublishState = Pick<Content, 'scheduledAt' | 'publishedAt' | 'publishedUrl'>;

/** A plan or a publication shows on the calendar, the content page and the content lists. */
function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: calendarKeys.all });
    void qc.invalidateQueries({ queryKey: ['contents'] });
  };
}

export function useSchedule(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (data: ScheduleContentInput) =>
      api.put<PublishState>(`/contents/${id}/schedule`, data),
    onSuccess: invalidate,
  });
}

/** For the calendar, where the content is only known when the drop happens. */
export function useScheduleAny() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...data }: ScheduleContentInput & { id: string }) =>
      api.put<PublishState>(`/contents/${id}/schedule`, data),
    onSuccess: invalidate,
  });
}

export function usePublish(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (data: PublishContentInput) =>
      api.post<PublishState>(`/contents/${id}/published`, data),
    onSuccess: invalidate,
  });
}

export function useUnpublish(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api.delete<PublishState>(`/contents/${id}/published`),
    onSuccess: invalidate,
  });
}
