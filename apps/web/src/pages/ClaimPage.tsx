import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { reservationsApi } from '../api/reservations';
import { errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Alert, Badge, Button, Card, Field, PageHeader, TextInput } from '../components/ui';

export function ClaimPage() {
  const [reservationId, setReservationId] = useState('');
  const [otpCode, setOtpCode] = useState('');

  const claim = useMutation({
    mutationFn: reservationsApi.claim,
    onSuccess: () => {
      setReservationId('');
      setOtpCode('');
    },
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    claim.mutate({ reservationId: reservationId.trim(), otpCode: otpCode.trim() });
  };

  const claimed = claim.data?.reservation;

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Claim a reservation"
        subtitle="Enter the patient's reservation reference and the 6-digit code they present."
      />

      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Reservation ID">
            <TextInput
              required
              placeholder="uuid"
              value={reservationId}
              onChange={(e) => setReservationId(e.target.value)}
            />
          </Field>
          <Field label="OTP code">
            <TextInput
              required
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              className="input font-mono tracking-[0.3em]"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
            />
          </Field>

          {claim.isError && <Alert>{errorMessage(claim.error)}</Alert>}

          <Button type="submit" className="w-full" loading={claim.isPending}>
            Confirm fulfilment
          </Button>
        </form>
      </Card>

      {claimed && (
        <Card className="mt-4">
          <Alert kind="success">Reservation fulfilled and stock permanently decremented.</Alert>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Status</dt>
              <dd>
                <Badge>{claimed.status}</Badge>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Medicine</dt>
              <dd className="font-medium text-slate-800">
                {claimed.medicine?.name}
                {claimed.medicine?.brand ? ` · ${claimed.medicine.brand}` : ''}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Quantity</dt>
              <dd>{claimed.quantity}</dd>
            </div>
            {claimed.claimedAt && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Claimed at</dt>
                <dd>{formatDateTime(claimed.claimedAt)}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}
    </div>
  );
}
