import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { useAuth, homePathForRole } from '../auth/AuthContext';
import { errorMessage } from '../lib/api';
import { Alert, Button, Card, Field, TextInput } from '../components/ui';

export function RegisterPage() {
  const { isAuthenticated, user, setSession } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '' });
  const update = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: authApi.register,
    onSuccess: (data) => {
      setSession(data);
      navigate(homePathForRole(data.user.role), { replace: true });
    },
  });

  if (isAuthenticated && user) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate({
      fullName: form.fullName,
      email: form.email,
      password: form.password,
      phone: form.phone.trim() || undefined,
    });
  };

  return (
    <div className="mx-auto mt-16 max-w-md px-4">
      <h1 className="mb-6 text-center text-2xl font-bold text-slate-900">Create a patient account</h1>

      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Full name">
            <TextInput required value={form.fullName} onChange={update('fullName')} />
          </Field>
          <Field label="Email">
            <TextInput type="email" required value={form.email} onChange={update('email')} />
          </Field>
          <Field label="Password" hint="At least 8 characters">
            <TextInput
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={update('password')}
            />
          </Field>
          <Field label="Phone (optional)">
            <TextInput value={form.phone} onChange={update('phone')} />
          </Field>

          {mutation.isError && <Alert>{errorMessage(mutation.error)}</Alert>}

          <Button type="submit" className="w-full" loading={mutation.isPending}>
            Create account
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-center text-sm text-slate-600">
        Already registered?{' '}
        <Link to="/login" className="font-semibold text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
