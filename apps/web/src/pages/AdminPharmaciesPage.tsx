import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pharmaciesApi } from '../api/pharmacies';
import { errorMessage } from '../lib/api';
import type { Pharmacy, PharmacyStatus } from '../lib/types';
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

interface PharmacyForm {
  name: string;
  licenseNo: string;
  address: string;
  phone: string;
  latitude: string;
  longitude: string;
  status: PharmacyStatus;
}

const EMPTY: PharmacyForm = {
  name: '',
  licenseNo: '',
  address: '',
  phone: '',
  latitude: '31.5204',
  longitude: '74.3587',
  status: 'VERIFIED',
};

export function AdminPharmaciesPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PharmacyForm>(EMPTY);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | PharmacyStatus>('');

  const list = useQuery({ queryKey: ['pharmacies'], queryFn: pharmaciesApi.list });

  const filtered = useMemo(() => {
    const rows = list.data?.pharmacies ?? [];
    const needle = q.trim().toLowerCase();
    return rows.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        p.name.toLowerCase().includes(needle) ||
        p.licenseNo.toLowerCase().includes(needle) ||
        p.address.toLowerCase().includes(needle)
      );
    });
  }, [list.data, q, statusFilter]);

  const paged = usePaged(filtered, 8);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['pharmacies'] });

  const create = useMutation({
    mutationFn: pharmaciesApi.create,
    onSuccess: () => {
      setForm(EMPTY);
      void invalidate();
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PharmacyStatus }) =>
      pharmaciesApi.setStatus(id, status),
    onSuccess: () => void invalidate(),
  });

  const rebuild = useMutation({ mutationFn: pharmaciesApi.rebuildGeo });

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({
      ...form,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          title="Pharmacies"
          subtitle="Verified pharmacies are indexed in Redis for proximity search."
        />
        <div className="mb-4 flex items-center gap-3">
          <Button variant="ghost" loading={rebuild.isPending} onClick={() => rebuild.mutate()}>
            Rebuild GEO index
          </Button>
          {rebuild.data && (
            <span className="text-sm text-emerald-700">Indexed {rebuild.data.indexed}.</span>
          )}
          {rebuild.isError && (
            <span className="text-sm text-rose-600">{errorMessage(rebuild.error)}</span>
          )}
        </div>

        {list.isLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Spinner /> Loading…
          </div>
        )}
        {list.isError && <Alert>{errorMessage(list.error)}</Alert>}

        {list.data && list.data.pharmacies.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-3">
            <TextInput
              className="input max-w-xs"
              placeholder="Search name / licence / address…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              className="input max-w-[12rem]"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as '' | PharmacyStatus)}
            >
              <option value="">All statuses</option>
              <option value="VERIFIED">VERIFIED</option>
              <option value="PENDING">PENDING</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </Select>
          </div>
        )}

        {list.data &&
          (list.data.pharmacies.length === 0 ? (
            <EmptyState>No pharmacies yet — create one below.</EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState>No pharmacies match the filter.</EmptyState>
          ) : (
            <>
              <ul className="space-y-3">
                {paged.slice.map((p) => (
                  <PharmacyRow
                    key={p.id}
                    pharmacy={p}
                    busy={setStatus.isPending}
                    onStatus={(status) => setStatus.mutate({ id: p.id, status })}
                    expanded={expanded === p.id}
                    onToggleStaff={() => setExpanded(expanded === p.id ? null : p.id)}
                  />
                ))}
              </ul>
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
        {setStatus.isError && (
          <div className="mt-3">
            <Alert>{errorMessage(setStatus.error)}</Alert>
          </div>
        )}
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Add a pharmacy</h2>
        <form onSubmit={onCreate} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <TextInput
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="License no.">
            <TextInput
              required
              value={form.licenseNo}
              onChange={(e) => setForm({ ...form, licenseNo: e.target.value })}
            />
          </Field>
          <Field label="Address">
            <TextInput
              required
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <TextInput
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label="Latitude">
            <TextInput
              required
              inputMode="decimal"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
            />
          </Field>
          <Field label="Longitude">
            <TextInput
              required
              inputMode="decimal"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as PharmacyStatus })}
            >
              <option value="VERIFIED">VERIFIED</option>
              <option value="PENDING">PENDING</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </Select>
          </Field>

          <div className="sm:col-span-2">
            {create.isError && (
              <div className="mb-3">
                <Alert>{errorMessage(create.error)}</Alert>
              </div>
            )}
            <Button type="submit" loading={create.isPending}>
              Create pharmacy
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function PharmacyRow({
  pharmacy,
  busy,
  onStatus,
  expanded,
  onToggleStaff,
}: {
  pharmacy: Pharmacy;
  busy: boolean;
  onStatus: (status: PharmacyStatus) => void;
  expanded: boolean;
  onToggleStaff: () => void;
}) {
  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-900">{pharmacy.name}</h3>
              <Badge>{pharmacy.status}</Badge>
            </div>
            <p className="text-sm text-slate-500">
              {pharmacy.licenseNo} · {pharmacy.address}
            </p>
            <p className="text-xs text-slate-400">
              {pharmacy.latitude}, {pharmacy.longitude} · id {pharmacy.id}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {pharmacy.status !== 'VERIFIED' && (
              <Button variant="ghost" disabled={busy} onClick={() => onStatus('VERIFIED')}>
                Verify
              </Button>
            )}
            {pharmacy.status !== 'SUSPENDED' && (
              <Button variant="ghost" disabled={busy} onClick={() => onStatus('SUSPENDED')}>
                Suspend
              </Button>
            )}
            <Button variant="ghost" onClick={onToggleStaff}>
              {expanded ? 'Hide staff form' : 'Add staff'}
            </Button>
          </div>
        </div>

        {expanded && <AddStaffForm pharmacyId={pharmacy.id} />}
      </Card>
    </li>
  );
}

function AddStaffForm({ pharmacyId }: { pharmacyId: string }) {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '' });

  const addStaff = useMutation({
    mutationFn: () =>
      pharmaciesApi.addStaff(pharmacyId, {
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone.trim() || undefined,
      }),
    onSuccess: () => setForm({ fullName: '', email: '', password: '', phone: '' }),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        addStaff.mutate();
      }}
      className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"
    >
      <Field label="Full name">
        <TextInput
          required
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
        />
      </Field>
      <Field label="Email">
        <TextInput
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </Field>
      <Field label="Password" hint="Min 8 characters">
        <TextInput
          type="password"
          required
          minLength={8}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </Field>
      <Field label="Phone (optional)">
        <TextInput
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
      </Field>
      <div className="sm:col-span-2">
        {addStaff.isError && (
          <div className="mb-2">
            <Alert>{errorMessage(addStaff.error)}</Alert>
          </div>
        )}
        {addStaff.data && (
          <div className="mb-2">
            <Alert kind="success">Pharmacist {addStaff.data.user.email} created.</Alert>
          </div>
        )}
        <Button type="submit" loading={addStaff.isPending}>
          Create pharmacist
        </Button>
      </div>
    </form>
  );
}
