import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, homePathForRole } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SearchPage } from './pages/SearchPage';
import { MyReservationsPage } from './pages/MyReservationsPage';
import { ReservationDetailPage } from './pages/ReservationDetailPage';
import { ClaimPage } from './pages/ClaimPage';
import { InventoryPage } from './pages/InventoryPage';
import { BatchSyncPage } from './pages/BatchSyncPage';
import { AdminPharmaciesPage } from './pages/AdminPharmaciesPage';
import { AdminMedicinesPage } from './pages/AdminMedicinesPage';

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? homePathForRole(user.role) : '/login'} replace />;
}

function Protected({
  roles,
  children,
}: {
  roles?: Parameters<typeof RequireAuth>[0]['roles'];
  children: ReactNode;
}) {
  return (
    <RequireAuth roles={roles}>
      <Layout>{children}</Layout>
    </RequireAuth>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route path="/" element={<HomeRedirect />} />

      <Route
        path="/search"
        element={
          <Protected roles={['PATIENT']}>
            <SearchPage />
          </Protected>
        }
      />
      <Route
        path="/reservations"
        element={
          <Protected roles={['PATIENT']}>
            <MyReservationsPage />
          </Protected>
        }
      />
      <Route
        path="/reservations/:id"
        element={
          <Protected>
            <ReservationDetailPage />
          </Protected>
        }
      />

      <Route
        path="/claim"
        element={
          <Protected roles={['PHARMACIST', 'ADMIN']}>
            <ClaimPage />
          </Protected>
        }
      />
      <Route
        path="/inventory"
        element={
          <Protected roles={['PHARMACIST', 'ADMIN']}>
            <InventoryPage />
          </Protected>
        }
      />
      <Route
        path="/inventory/sync"
        element={
          <Protected roles={['PHARMACIST', 'ADMIN']}>
            <BatchSyncPage />
          </Protected>
        }
      />

      <Route
        path="/admin/pharmacies"
        element={
          <Protected roles={['ADMIN']}>
            <AdminPharmaciesPage />
          </Protected>
        }
      />
      <Route
        path="/admin/medicines"
        element={
          <Protected roles={['ADMIN']}>
            <AdminMedicinesPage />
          </Protected>
        }
      />

      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}
