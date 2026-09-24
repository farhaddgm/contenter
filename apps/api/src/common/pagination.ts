import type { Paginated, PaginationQuery } from '@contenter/shared';

type PageParams = Pick<PaginationQuery, 'page' | 'pageSize'>;

export function paginate(query: PageParams) {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function toPage<T>(items: T[], total: number, query: PageParams): Paginated<T> {
  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
