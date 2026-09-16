import React, { Suspense, lazy, startTransition, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { BrandMark } from './components/Icons';
import { useInspectGuard } from './hooks/useInspectGuard';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminChat = lazy(() => import('./pages/AdminChat'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const Guide = lazy(() => import('./pages/Guide'));
const Payment = lazy(() => import('./pages/Payment'));

function PageLoader() {
  return (
    <div className="page-loader">
      <BrandMark size={48} />
      <span>Chargement…</span>
    </div>
  );
}

function PageFade({ children }) {
  const location = useLocation();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(false);
    const t = requestAnimationFrame(() => {
      startTransition(() => setVisible(true));
    });
    return () => cancelAnimationFrame(t);
  }, [location.pathname]);

  return <div className={`page-fade${visible ? ' page-fade-in' : ''}`}>{children}</div>;
}

function PrivateRoute({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to={role === 'admin' ? '/admin/login' : '/login'} replace />;
  if (role === 'admin' && user.role !== 'admin') return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  useInspectGuard(true);

  return (
    <Suspense fallback={<PageLoader />}>
      <PageFade>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route
            path="/dashboard"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/guide"
            element={
              <PrivateRoute>
                <Guide />
              </PrivateRoute>
            }
          />
          <Route
            path="/paiement"
            element={
              <PrivateRoute>
                <Payment />
              </PrivateRoute>
            }
          />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/portail-9f3a2e" element={<Navigate to="/admin/login" replace />} />
          <Route
            path="/admin"
            element={
              <PrivateRoute role="admin">
                <AdminDashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/admin/whatsapp"
            element={
              <PrivateRoute role="admin">
                <AdminChat />
              </PrivateRoute>
            }
          />
          <Route path="/portail-9f3a2e/dashboard" element={<Navigate to="/admin" replace />} />
          <Route path="/portail-9f3a2e/whatsapp" element={<Navigate to="/admin/whatsapp" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </PageFade>
    </Suspense>
  );
}
