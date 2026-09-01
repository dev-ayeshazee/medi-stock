import { useCallback, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reservationsApi } from '../api/reservations';
import { errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Countdown } from '../components/Countdown';
import { Alert, Badge, Button, Card, PageHeader, Spinner } from '../components/ui';

export function ReservationDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['reservation', id],
    queryFn: () => reservationsApi.get(id),
    enabled: Boolean(id),
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['reservation', id] });
  }, [queryClient, id]);

  const cancel = useMutation({
    mutationFn: () => reservationsApi.cancel({ reservationId: id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reservation', id] });
      void queryClient.invalidateQueries({ queryKey: ['reservations', 'mine'] });
    },
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
        <Spinner /> Loading reservation…
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-4">
        <Alert>{query.error ? errorMessage(query.error) : 'Reservation not found'}</Alert>
        <Button variant="ghost" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    );
  }

  const r = query.data.reservation;
  const isPending = r.status === 'PENDING';

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Reservation" subtitle={`Reference ${r.id}`} />

      <Card className="space-y-6">
        <div className="flex items-center justify-between">
          <Badge>{r.status}</Badge>
          {isPending && <Countdown expiresAt={r.expiresAt} onElapsed={refresh} />}
        </div>

        {isPending && r.otpCode && (
          <div className="rounded-lg border border-brand-100 bg-brand-50 p-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
              Show this code at the counter
            </p>
            <p className="mt-1 font-mono text-4xl font-black tracking-[0.3em] text-brand-700">
              {r.otpCode}
            </p>
          </div>
        )}

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Row label="Medicine">
            {r.medicine ? (
              <>
                {r.medicine.name}
                {r.medicine.brand ? ` · ${r.medicine.brand}` : ''}
                <span className="block text-slate-500">
                  {r.medicine.strength} · {r.medicine.form}
                </span>
              </>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Quantity">{r.quantity}</Row>
          <Row label="Pharmacy">
            {r.pharmacy ? (
              <>
                {r.pharmacy.name}
                <span className="block text-slate-500">{r.pharmacy.address}</span>
                <span className="block text-slate-500">☎ {r.pharmacy.phone}</span>
              </>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Created">{formatDateTime(r.createdAt)}</Row>
          <Row label="Expires">{formatDateTime(r.expiresAt)}</Row>
          {r.claimedAt && <Row label="Claimed">{formatDateTime(r.claimedAt)}</Row>}
          {r.releasedAt && <Row label="Released">{formatDateTime(r.releasedAt)}</Row>}
        </dl>

        {cancel.isError && <Alert>{errorMessage(cancel.error)}</Alert>}
        {cancel.data?.outcome.changed && (
          <Alert kind="success">Hold cancelled — the stock has been released.</Alert>
        )}

        <div className="flex gap-3">
          {isPending && (
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel hold
            </Button>
          )}
          <Link to="/reservations" className="btn-ghost">
            Back to my reservations
          </Link>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{children}</dd>
    </div>
  );
}
