import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { useAuth, homePathForRole } from '../auth/AuthContext';
import { errorMessage } from '../lib/api';
import { Alert, Button, Card, Field, TextInput } from '../components/ui';

export function LoginPage() {
  const { isAuthenticated, user, setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      setSession(data);
      navigate(location.state?.from ?? homePathForRole(data.user.role), { replace: true });
    },
  });

  if (isAuthenticated && user) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({ email, password });
  };

  return (
    <div className="mx-auto mt-16 max-w-md px-4">
      <h1 className="mb-1 text-center text-3xl font-black text-brand-700">MediStock</h1>
      <p className="mb-6 text-center text-sm text-slate-600">
        Critical-medicine finder &amp; reservation system
      </p>

      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email">
            <TextInput
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <TextInput
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {mutation.isError && <Alert>{errorMessage(mutation.error)}</Alert>}

          <Button type="submit" className="w-full" loading={mutation.isPending}>
            Sign in
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-center text-sm text-slate-600">
        New patient?{' '}
        <Link to="/register" className="font-semibold text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
        <p className="font-semibold text-slate-600">Seed logins (password: Password123!)</p>
        <ul className="mt-1 space-y-0.5">
          <li>patient@medistock.dev — patient</li>
          <li>pharmacist.ph-0001@medistock.dev — pharmacist</li>
          <li>admin@medistock.dev — admin</li>
        </ul>
      </div>
    </div>
  );
}
