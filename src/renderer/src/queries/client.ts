import { QueryClient } from '@tanstack/react-query'

// One cache for the renderer's lifetime. Remote queries retain the library defaults.
export const queryClient = new QueryClient()
