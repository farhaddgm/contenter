import { QueryClient, type DefaultOptions, type UseMutationOptions } from '@tanstack/react-query';

export const queryConfig = {
  queries: {
    refetchOnWindowFocus: false,
    retry: (count, error) => {
      const status = (error as { status?: number }).status;
      if (status && status >= 400 && status < 500) return false;
      return count < 2;
    },
    staleTime: 30_000,
  },
} satisfies DefaultOptions;

export const createQueryClient = () => new QueryClient({ defaultOptions: queryConfig });

export type ApiFnReturnType<FnType extends (...args: never[]) => Promise<unknown>> = Awaited<
  ReturnType<FnType>
>;

export type MutationConfig<MutationFnType extends (...args: never[]) => Promise<unknown>> =
  UseMutationOptions<ApiFnReturnType<MutationFnType>, Error, Parameters<MutationFnType>[0]>;
