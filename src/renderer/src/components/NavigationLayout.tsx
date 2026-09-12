import { Suspense } from 'react'
import MenuOpenIcon from '@mui/icons-material/MenuOpen'
import MenuIcon from '@mui/icons-material/Menu'
import {
  AppBar,
  Box,
  Button,
  Divider,
  GlobalStyles,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Toolbar,
  Typography
} from '@mui/material'
import { NavLink, Outlet } from 'react-router-dom'
import { useSidebarStore } from '../stores/sidebar'
import { useAppVersionQuery } from '../queries/ipc'
import Versions from './Versions'
import SyncPanel from './SyncPanel'

export default function NavigationLayout(): React.JSX.Element {
  const isOpen = useSidebarStore((state) => state.isOpen)
  const toggle = useSidebarStore((state) => state.toggle)
  const close = useSidebarStore((state) => state.close)
  const version = useAppVersionQuery()
  return (
    <>
      <GlobalStyles
        styles={{
          body: { display: 'block' },
          '#root': { display: 'block', width: '100%', marginBottom: 0 }
        }}
      />
      <AppBar position="sticky">
        <Toolbar sx={{ gap: 2 }}>
          <Button
            color="inherit"
            onClick={toggle}
            aria-expanded={isOpen}
            aria-controls="main-navigation"
          >
            {isOpen ? <MenuOpenIcon /> : <MenuIcon />}
          </Button>
          <Typography variant="h6" component="div">
            PriceDesk
          </Typography>
        </Toolbar>
      </AppBar>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            md: isOpen ? '230px minmax(0, 1fr)' : 'minmax(0, 1fr)'
          },
          gap: 3,
          p: { xs: 2, lg: 3 }
        }}
      >
        {isOpen && (
          <Paper
            component="nav"
            id="main-navigation"
            aria-label="Main navigation"
            variant="outlined"
            sx={{ alignSelf: 'start', p: 1, height: '100%' }}
          >
            <List>
              {[
                ['/products', 'Products'],
                ['/quotes', 'Saved quotes'],
                ['/quotes/new', 'New quote']
              ].map(([to, label]) => (
                <ListItemButton
                  key={to}
                  component={NavLink}
                  to={to}
                  end
                  sx={{ '&.active': { bgcolor: 'action.selected' }, borderRadius: 1 }}
                >
                  <ListItemText primary={label} />
                </ListItemButton>
              ))}
            </List>
            <Button
              onClick={close}
              size="small"
              sx={{ display: { xs: 'inline-flex', md: 'none' } }}
            >
              Close menu
            </Button>
          </Paper>
        )}
        <Paper
          component="main"
          variant="outlined"
          sx={{
            minWidth: 0,
            p: { xs: 2, lg: 3 },
            borderRadius: 3,
            '& .catalogue': { width: '100%', paddingTop: 0 },
            '& .catalogue h1': { fontSize: { xs: 24, lg: 30 }, lineHeight: 1.3 }
          }}
        >
          <SyncPanel />
          <Suspense fallback={<Typography role="status">Loading page…</Typography>}>
            <Outlet />
          </Suspense>
          <Divider sx={{ my: 3 }} />
          <Box
            component="footer"
            sx={{
              '& .versions': { display: 'flex', flexWrap: 'wrap', gap: 1 },
              '& .versions li': { fontSize: 12, padding: '0 10px' }
            }}
          >
            <Button onClick={() => void version.refetch()} disabled={version.isFetching}>
              {version.isFetching ? 'Getting version…' : 'Get app version'}
            </Button>
            <Typography role="status" variant="body2">
              {version.isError
                ? 'Could not get the app version. Please try again.'
                : version.data
                  ? `App version: ${version.data}`
                  : ''}
            </Typography>
            <Versions />
          </Box>
        </Paper>
      </Box>
    </>
  )
}
