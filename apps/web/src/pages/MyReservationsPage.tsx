import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { reservationsApi } from '../api/reservations';
import { errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { ReservationStatus } from '../lib/types';
import {
  Alert,
  Badge,
  EmptyState,
  PageHeader,
  Pager,
  Select,
  Spinner,
  usePaged,
} from '../components/ui';

const STATUSES: ReservationStatus[] = ['PENDING', 'CLAIMED', 'EXPIRED', 'CANCELLED'];

export function MyReservationsPage() {
  const [status, setStatus] = useState<'' | ReservationStatus>('');

  const query = useQuery({
    queryKey: ['reservations', 'mine', status],
    queryFn: () =>
      reservationsApi.list({ status: status || undefined, limit: 200 }),
    refetchInterval: 15_000,
  });

  const paged = usePaged(query.data?.reservations ?? [], 15);

  return (
    <div>
      <PageHeader title="My reservations" subtitle="Holds you have placed, most recent first." />

      {query.isLoading && (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <Spinner /> Loading…
        </div>
      )}
      {query.isError && <Alert>{errorMessage(query.error)}</Alert>}

      <div className="mb-4 max-w-[14rem]">
        <Select
          className="input"
          value={status}
          onChange={(e) => setStatus(e.target.value as '' | ReservationStatus)}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {query.data &&
        (query.data.reservations.length === 0 ? (
          <EmptyState>
            {status ? (
              `No ${status} reservations.`
            ) : (
              <>
                No reservations yet.{' '}
                <Link to="/search" className="font-semibold text-brand-700 hover:underline">
                  Find a medicine
                </Link>
                .
              </>
            )}
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Medicine</th>
                    <th className="px-4 py-3">Pharmacy</th>
                    <th className="px-4 py-3">Qty</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Expires</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paged.slice.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {r.medicine?.name ?? '—'}
                      {r.medicine?.brand ? ` · ${r.medicine.brand}` : ''}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.pharmacy?.name ?? '—'}</td>
                    <td className="px-4 py-3">{r.quantity}</td>
                    <td className="px-4 py-3">
                      <Badge>{r.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(r.expiresAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/reservations/${r.id}`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          View
                        </Link>
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
  );
}
