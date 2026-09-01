import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { medicinesApi, type CreateMedicineBody } from '../api/medicines';
import { errorMessage } from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Pager,
  Select,
  Spinner,
  TextInput,
  usePaged,
} from '../components/ui';

const EMPTY: CreateMedicineBody = {
  name: '',
  brand: '',
  genericFormula: '',
  strength: '',
  form: '',
  isCritical: false,
};

export function AdminMedicinesPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateMedicineBody>(EMPTY);
  const [search, setSearch] = useState('');
  const [critical, setCritical] = useState<'' | 'true' | 'false'>('');

  const list = useQuery({
    queryKey: ['medicines', 'admin', search, critical],
    queryFn: () =>
      medicinesApi.list({
        q: search.trim() || undefined,
        critical: critical === '' ? undefined : critical === 'true',
        limit: 200,
      }),
  });

  const paged = usePaged(list.data?.medicines ?? [], 12);

  const create = useMutation({
    mutationFn: medicinesApi.create,
    onSuccess: () => {
      setForm(EMPTY);
      void queryClient.invalidateQueries({ queryKey: ['medicines'] });
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ ...form, brand: form.brand?.trim() || undefined });
  };

  return (
    <div className="space-y-8">
      <div>
        <PageHeader title="Medicine catalogue" subtitle="Salt-level entries used for substitution." />

        <div className="mb-4 flex flex-wrap gap-3">
          <TextInput
            className="input max-w-xs"
            placeholder="Search name / formula / brand…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            className="input max-w-[12rem]"
            value={critical}
            onChange={(e) => setCritical(e.target.value as '' | 'true' | 'false')}
          >
            <option value="">All medicines</option>
            <option value="true">Critical only</option>
            <option value="false">Non-critical only</option>
          </Select>
        </div>

        {list.isLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Spinner /> Loading…
          </div>
        )}
        {list.isError && <Alert>{errorMessage(list.error)}</Alert>}

        {list.data &&
          (list.data.medicines.length === 0 ? (
            <EmptyState>No medicines match.</EmptyState>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Brand</th>
                      <th className="px-4 py-3">Formula</th>
                      <th className="px-4 py-3">Strength</th>
                      <th className="px-4 py-3">Form</th>
                      <th className="px-4 py-3">Critical</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paged.slice.map((m) => (
                      <tr key={m.id}>
                        <td className="px-4 py-3 font-medium text-slate-800">{m.name}</td>
                        <td className="px-4 py-3 text-slate-600">{m.brand ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{m.genericFormula}</td>
                        <td className="px-4 py-3 text-slate-600">{m.strength}</td>
                        <td className="px-4 py-3 text-slate-600">{m.form}</td>
                        <td className="px-4 py-3">
                          {m.isCritical ? <Badge>CRITICAL</Badge> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                page={paged.page}
                pageCount={paged.pageCount}
                from={paged.from}
                to={paged.to}
                total={paged.total}
                onPage={paged.setPage}
              />
            </>
          ))}
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Add a medicine</h2>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <TextInput
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Brand (optional)">
            <TextInput
              value={form.brand ?? ''}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
            />
          </Field>
          <Field label="Generic formula">
            <TextInput
              required
              value={form.genericFormula}
              onChange={(e) => setForm({ ...form, genericFormula: e.target.value })}
            />
          </Field>
          <Field label="Strength">
            <TextInput
              required
              placeholder="e.g. 500mg"
              value={form.strength}
              onChange={(e) => setForm({ ...form, strength: e.target.value })}
            />
          </Field>
          <Field label="Form">
            <TextInput
              required
              placeholder="e.g. capsule"
              value={form.form}
              onChange={(e) => setForm({ ...form, form: e.target.value })}
            />
          </Field>
          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={form.isCritical}
              onChange={(e) => setForm({ ...form, isCritical: e.target.checked })}
            />
            <span className="text-sm text-slate-700">Critical medicine</span>
          </label>

          <div className="sm:col-span-2">
            {create.isError && (
              <div className="mb-3">
                <Alert>{errorMessage(create.error)}</Alert>
              </div>
            )}
            <Button type="submit" loading={create.isPending}>
              Create medicine
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
