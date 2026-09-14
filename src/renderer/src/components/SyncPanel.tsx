import { Alert, Box, Button, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

export default function SyncPanel(): React.JSX.Element {
  const client = useQueryClient()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
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
        disabled={
          !status.data || sync.isPending || status.data.running || !status.data.pendingCount
        }
      >
        {sync.isPending || status.data?.running
          ? 'Syncing…'
          : status.data?.pendingCount === 0
            ? 'No pending uploads'
            : 'Sync Now'}
      </Button>
      {sync.isSuccess && !status.data?.running && (
        <Alert
          severity={status.data?.pendingCount || status.data?.failedCount ? 'warning' : 'success'}
        >
          {status.data?.pendingCount
            ? 'Sync attempt finished. Pending uploads will retry automatically, or you can try Sync Now again.'
            : status.data?.failedCount
              ? 'Sync attempt finished. Some uploads need review below.'
              : 'All queued quotes are synced.'}
        </Alert>
      )}
      {(status.isError || sync.isError) && (
        <Alert severity="error">
          Could not run or read sync. Your quotes remain saved locally.
        </Alert>
      )}
      {status.data?.failures.map((failure) => {
        const seconds = Math.max(0, Math.ceil(((failure.nextRetryAt ?? now) - now) / 1000))
        const countdown =
          seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
        return (
          <Alert
            key={failure.operationId}
            severity={failure.status === 'failed' ? 'error' : 'warning'}
            sx={{ mt: 1 }}
          >
            Quote #{failure.quoteId}: {failure.lastError} (attempts: {failure.attemptCount}).{' '}
            {failure.status === 'failed'
              ? 'Upload needs review.'
              : sync.isPending || status.data.running
                ? 'Sync in progress…'
                : seconds > 0
                  ? `Retry in ${countdown}.`
                  : 'Waiting to retry…'}
          </Alert>
        )
      })}
    </Box>
  )
}
