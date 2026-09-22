import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useSession } from './store/session';
import { AppShell } from './layouts/AppShell';
import { Spinner } from './ui/components';

const SignIn = lazy(() => import('./features/auth/SignIn'));
const Register = lazy(() => import('./features/auth/Register'));
const AcceptInvite = lazy(() => import('./features/auth/AcceptInvite'));
const ForgotPassword = lazy(() => import('./features/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./features/auth/ResetPassword'));
const VerifyEmail = lazy(() => import('./features/auth/VerifyEmail'));
const Dashboard = lazy(() => import('./features/dashboard/Dashboard'));
const Projects = lazy(() => import('./features/projects/Projects'));
const ProjectHub = lazy(() => import('./features/projects/ProjectHub'));
const Clients = lazy(() => import('./features/clients/Clients'));
const TaskManager = lazy(() => import('./features/tasks/TaskManager'));
const CompanySchedule = lazy(() => import('./features/schedule/CompanySchedule'));
const MessagesHome = lazy(() => import('./features/messages/MessagesHome'));
const DocumentsHome = lazy(() => import('./features/documents/DocumentsHome'));
const Settings = lazy(() => import('./features/settings/Settings'));
const FieldMode = lazy(() => import('./features/field/FieldMode'));
const PortalHome = lazy(() => import('./features/portal/PortalHome'));
const VendorHome = lazy(() => import('./features/portal/VendorHome'));
const TimePage = lazy(() => import('./features/time/TimePage'));
const Assistant = lazy(() => import('./features/assistant/Assistant'));
const Estimating = lazy(() => import('./features/estimating/Estimating'));
const BudgetOverview = lazy(() => import('./features/budget/BudgetOverview'));
const InvoicesHome = lazy(() => import('./features/invoices/InvoicesHome'));
const Vendors = lazy(() => import('./features/vendors/Vendors'));
const Leads = lazy(() => import('./features/leads/Leads'));
const Reports = lazy(() => import('./features/reports/Reports'));

function Centered({ children }: { children: ReactNode }) { return <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>{children}</div>; }

function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (session.status === 'loading') return <Centered><Spinner /></Centered>;
  if (session.status === 'anonymous') return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const session = useSession();
  if (session.membership?.defaultMode === 'field') return <Navigate to="/field" replace />;
  if (session.membership?.external) return session.membership.roleKey === 'vendor' ? <VendorHome /> : <PortalHome />;
  return <Dashboard />;
}

export function App() {
  return (
    <Suspense fallback={<Centered><Spinner /></Centered>}>
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/register" element={<Register />} />
        <Route path="/invite" element={<AcceptInvite />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/*" element={<RequireAuth><AppShell><Suspense fallback={<Centered><Spinner /></Centered>}>
          <Routes>
            <Route index element={<HomeRedirect />} />
            <Route path="field" element={<FieldMode />} />
            <Route path="field/:projectId" element={<FieldMode />} />
            <Route path="bids/:bidRequestId" element={<VendorHome />} />
            <Route path="time" element={<TimePage />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:projectId/*" element={<ProjectHub />} />
            <Route path="clients" element={<Clients />} />
            <Route path="clients/:clientId" element={<Clients />} />
            <Route path="tasks" element={<TaskManager />} />
            <Route path="schedule" element={<CompanySchedule />} />
            <Route path="messages" element={<MessagesHome />} />
            <Route path="messages/:threadId" element={<MessagesHome />} />
            <Route path="documents" element={<DocumentsHome />} />
            <Route path="settings/*" element={<Settings />} />
            <Route path="leads" element={<Leads />} />
            <Route path="leads/:leadId" element={<Leads />} />
            <Route path="vendors" element={<Vendors />} />
            <Route path="vendors/:vendorId" element={<Vendors />} />
            <Route path="estimating" element={<Estimating />} />
            <Route path="budget" element={<BudgetOverview />} />
            <Route path="invoices" element={<InvoicesHome />} />
            <Route path="invoices/:invoiceId" element={<InvoicesHome />} />
            <Route path="reports" element={<Reports />} />
            <Route path="reports/:reportKey" element={<Reports />} />
            <Route path="assistant" element={<Assistant />} />
            <Route path="assistant/:conversationId" element={<Assistant />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense></AppShell></RequireAuth>} />
      </Routes>
    </Suspense>
  );
}
