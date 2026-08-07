import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from 'react-router';
import { useLogout, useMe } from './api/hooks.js';
import { LoginPage } from './pages/LoginPage.js';
import { AccountsPage } from './pages/AccountsPage.js';
import { AccountDetailPage } from './pages/AccountDetailPage.js';
import { ContactsPage } from './pages/ContactsPage.js';
import { ContactDetailPage } from './pages/ContactDetailPage.js';
import { LeadsPage } from './pages/LeadsPage.js';
import { LeadDetailPage } from './pages/LeadDetailPage.js';
import { BoardPage } from './pages/BoardPage.js';
import { DealDetailPage } from './pages/DealDetailPage.js';
import { TasksPage } from './pages/TasksPage.js';
import { CapturePage } from './pages/CapturePage.js';
import { ApprovalsPage } from './pages/ApprovalsPage.js';
import { MeetingsPage } from './pages/MeetingsPage.js';
import { ProjectsPage } from './pages/ProjectsPage.js';
import { ProjectDetailPage } from './pages/ProjectDetailPage.js';
import { PortalPage } from './pages/PortalPage.js';
import { WorkflowsPage } from './pages/WorkflowsPage.js';
import { ReportsPage } from './pages/ReportsPage.js';
import { CustomizationPage } from './pages/CustomizationPage.js';
import { IntegrationsPage } from './pages/IntegrationsPage.js';
import { NotificationBell } from './components/NotificationBell.js';
import { GlobalSearch } from './components/GlobalSearch.js';
import { CopilotPanel } from './components/CopilotPanel.js';

function Shell(props: { children: ReactNode }) {
  const { data: me, isLoading } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  if (isLoading) return <p className="p-8 text-sm text-gray-500">Loading…</p>;
  if (!me) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <nav className="flex items-center gap-4 text-sm font-medium text-gray-700">
            <span className="text-base font-semibold text-gray-900">{me.organization.name}</span>
            <Link className="hover:text-blue-700" to="/deals">
              Pipeline
            </Link>
            <Link className="hover:text-blue-700" to="/leads">
              Leads
            </Link>
            <Link className="hover:text-blue-700" to="/accounts">
              Accounts
            </Link>
            <Link className="hover:text-blue-700" to="/contacts">
              Contacts
            </Link>
            <Link className="hover:text-blue-700" to="/tasks">
              Tasks
            </Link>
            <Link className="hover:text-blue-700" to="/projects">
              Projects
            </Link>
            <Link className="hover:text-blue-700" to="/meetings">
              Meetings
            </Link>
            <Link className="hover:text-blue-700" to="/capture">
              Capture
            </Link>
            <Link className="hover:text-blue-700" to="/approvals">
              Approvals
            </Link>
            <Link className="hover:text-blue-700" to="/reports">
              Reports
            </Link>
            <Link className="hover:text-blue-700" to="/workflows">
              Workflows
            </Link>
            <Link className="hover:text-blue-700" to="/settings/customization">
              Setup
            </Link>
            <Link className="hover:text-blue-700" to="/settings/integrations">
              Integrations
            </Link>
          </nav>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <GlobalSearch />
            <NotificationBell />
            <span>{me.user.name}</span>
            <button
              type="button"
              className="text-blue-700 hover:underline"
              onClick={() => {
                logout.mutate(undefined, { onSuccess: () => navigate('/login') });
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{props.children}</main>
      <CopilotPanel />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/portal/:token" element={<PortalPage />} />
        <Route
          path="/"
          element={
            <Shell>
              <Navigate to="/accounts" replace />
            </Shell>
          }
        />
        <Route
          path="/accounts"
          element={
            <Shell>
              <AccountsPage />
            </Shell>
          }
        />
        <Route
          path="/accounts/:id"
          element={
            <Shell>
              <AccountDetailPage />
            </Shell>
          }
        />
        <Route
          path="/contacts"
          element={
            <Shell>
              <ContactsPage />
            </Shell>
          }
        />
        <Route
          path="/contacts/:id"
          element={
            <Shell>
              <ContactDetailPage />
            </Shell>
          }
        />
        <Route
          path="/leads"
          element={
            <Shell>
              <LeadsPage />
            </Shell>
          }
        />
        <Route
          path="/leads/:id"
          element={
            <Shell>
              <LeadDetailPage />
            </Shell>
          }
        />
        <Route
          path="/deals"
          element={
            <Shell>
              <BoardPage />
            </Shell>
          }
        />
        <Route
          path="/deals/:id"
          element={
            <Shell>
              <DealDetailPage />
            </Shell>
          }
        />
        <Route
          path="/tasks"
          element={
            <Shell>
              <TasksPage />
            </Shell>
          }
        />
        <Route
          path="/projects"
          element={
            <Shell>
              <ProjectsPage />
            </Shell>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <Shell>
              <ProjectDetailPage />
            </Shell>
          }
        />
        <Route
          path="/capture"
          element={
            <Shell>
              <CapturePage />
            </Shell>
          }
        />
        <Route
          path="/meetings"
          element={
            <Shell>
              <MeetingsPage />
            </Shell>
          }
        />
        <Route
          path="/approvals"
          element={
            <Shell>
              <ApprovalsPage />
            </Shell>
          }
        />
        <Route
          path="/workflows"
          element={
            <Shell>
              <WorkflowsPage />
            </Shell>
          }
        />
        <Route
          path="/reports"
          element={
            <Shell>
              <ReportsPage />
            </Shell>
          }
        />
        <Route
          path="/settings/customization"
          element={
            <Shell>
              <CustomizationPage />
            </Shell>
          }
        />
        <Route
          path="/settings/integrations"
          element={
            <Shell>
              <IntegrationsPage />
            </Shell>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
