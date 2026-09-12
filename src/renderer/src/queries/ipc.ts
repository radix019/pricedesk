import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type { CreateQuoteInput, Product, Quote, QuoteSummary } from '../../../preload/api'

// Only local IPC uses these options: SQLite does not depend on internet access.
const localIpc = { networkMode: 'always', retry: false } as const

export function useProductsQuery(): UseQueryResult<Product[], Error> {
  return useQuery({ ...localIpc, queryKey: ['products'], queryFn: () => window.api.getProducts() })
}

export function useQuotesQuery(): UseQueryResult<QuoteSummary[], Error> {
  return useQuery({ ...localIpc, queryKey: ['quotes'], queryFn: () => window.api.listQuotes() })
}

export function useQuoteQuery(id: number): UseQueryResult<Quote | null, Error> {
  return useQuery({
    ...localIpc,
    queryKey: ['quotes', id],
    queryFn: () => window.api.getQuote(id),
    enabled: Number.isSafeInteger(id) && id > 0
  })
}

export function useAppVersionQuery(): UseQueryResult<string, Error> {
  return useQuery({
    ...localIpc,
    queryKey: ['app-version'],
    queryFn: () => window.api.getAppVersion(),
    enabled: false
  })
}

export function useCreateQuoteMutation(): UseMutationResult<Quote, Error, CreateQuoteInput> {
  const client = useQueryClient()
  return useMutation({
    ...localIpc,
    mutationFn: (input: CreateQuoteInput) => window.api.createQuote(input),
    onSuccess: async (quote) => {
      client.setQueryData(['quotes', quote.id], quote)
      await client.invalidateQueries({ queryKey: ['quotes'], exact: true })
    }
  })
}
