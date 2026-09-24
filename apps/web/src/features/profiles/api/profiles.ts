import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ContentProfile,
  CreateTraitInput,
  JobAccepted,
  ProfileTrait,
  UpdateProfileInput,
  UpdateTraitInput,
} from '@contenter/shared';
import { api } from '@/lib/api-client';

export type ProfileSummary = ContentProfile & { _count: { traits: number } };

export const profileKeys = {
  list: (topicId: string) => ['profiles', 'topic', topicId] as const,
  one: (id: string) => ['profiles', id] as const,
  all: ['profiles'] as const,
};

export function useProfiles(topicId: string) {
  return useQuery({
    queryKey: profileKeys.list(topicId),
    queryFn: () => api.get<ProfileSummary[]>(`/topics/${topicId}/profiles`),
  });
}

export function useProfile(id: string | undefined) {
  return useQuery({
    queryKey: profileKeys.one(id ?? ''),
    queryFn: () => api.get<ContentProfile & { traits: ProfileTrait[] }>(`/profiles/${id}`),
    enabled: !!id,
  });
}

function useInvalidateProfiles() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: profileKeys.all });
    void qc.invalidateQueries({ queryKey: ['topics'] });
  };
}

export function useBuildProfile(topicId: string) {
  return useMutation({
    mutationFn: (sampleIds?: string[]) =>
      api.post<JobAccepted>(`/topics/${topicId}/profiles/build`, { sampleIds }),
  });
}

export function useUpdateProfile() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProfileInput }) =>
      api.patch<ContentProfile>(`/profiles/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useApproveProfile() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: (id: string) => api.post<ContentProfile>(`/profiles/${id}/approve`),
    onSuccess: invalidate,
  });
}

export function useArchiveProfile() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: (id: string) => api.post<ContentProfile>(`/profiles/${id}/archive`),
    onSuccess: invalidate,
  });
}

export function useAddTrait(profileId: string) {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: (data: CreateTraitInput) =>
      api.post<ProfileTrait>(`/profiles/${profileId}/traits`, data),
    onSuccess: invalidate,
  });
}

export function useUpdateTrait() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTraitInput }) =>
      api.patch<ProfileTrait>(`/traits/${id}`, data),
    onSuccess: invalidate,
  });
}

export function useDeleteTrait() {
  const invalidate = useInvalidateProfiles();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/traits/${id}`),
    onSuccess: invalidate,
  });
}
