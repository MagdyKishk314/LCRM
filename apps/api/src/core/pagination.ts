import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Capped so a client cannot ask for an unbounded scan of a million-contact account.
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export function paginate<T>(data: T[], total: number, input: PaginationInput) {
  return {
    data,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

/** Translate `?sort=-createdAt` into a Mongoose sort object. */
export function parseSort(sort: string | undefined, fallback: Record<string, 1 | -1>) {
  if (!sort) return fallback;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  if (!/^[a-zA-Z0-9_.]+$/.test(field)) return fallback;
  return { [field]: desc ? -1 : 1 } as Record<string, 1 | -1>;
}
