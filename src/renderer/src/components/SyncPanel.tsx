import { Alert, Box, Button, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export default function SyncPanel(): React.JSX.Element {
  const client = useQueryClient()
  const status = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => window.api.getSyncStatus(),
    networkMode: 'always',
    retry: false,
    refetchInterval: 1000
  })
  const sync = useMutation({
    mutationFn: () => window.api.syncNow(),
    networkMode: 'always',
    retry: false,
    onSuccess: (data) => {
      client.setQueryData(['sync-status'], data)
    }
  })
  return (
    <Box sx={{ mb: 3 }}>
      <Typography role="status" variant="body2">
        {status.data
          ? `${status.data.pendingCount} pending · ${status.data.failedCount} need review · ${status.data.syncedCount} synced`
          : 'Loading sync status…'}
      </Typography>
      <Button
        onClick={() => sync.mutate()}
        disabled={!status.data || sync.isPending || status.data.running}
      >
        {sync.isPending || status.data?.running ? 'Syncing…' : 'Sync Now'}
      </Button>
      {(status.isError || sync.isError) && (
        <Alert severity="error">
          Could not run or read sync. Your quotes remain saved locally.
        </Alert>
      )}
      {status.data?.failures.map((failure) => (
        <Alert
          key={failure.operationId}
          severity={failure.status === 'failed' ? 'error' : 'warning'}
          sx={{ mt: 1 }}
        >
          Quote #{failure.quoteId}: {failure.lastError} (attempts: {failure.attemptCount}).{' '}
          {failure.status === 'failed'
            ? 'Upload needs review.'
            : `Retry after ${new Date(failure.nextRetryAt!).toLocaleString()}.`}
        </Alert>
      ))}
    </Box>
  )
}
