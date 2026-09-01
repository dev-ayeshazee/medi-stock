import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { medicinesApi, type SearchParams } from '../api/medicines';
import { reservationsApi } from '../api/reservations';
import { errorMessage } from '../lib/api';
import { formatDistance, formatMoney } from '../lib/format';
import type { SearchResult } from '../lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Spinner,
  TextInput,
} from '../components/ui';

// Central Lahore (Gulberg) — the default search origin.
const DEFAULT_LOCATION = { lat: 31.5204, lon: 74.3587 };

export function SearchPage() {
  const navigate = useNavigate();

  const [lat, setLat] = useState(String(DEFAULT_LOCATION.lat));
  const [lon, setLon] = useState(String(DEFAULT_LOCATION.lon));
  const [radiusKm, setRadiusKm] = useState('10');
  const [mode, setMode] = useState<'generic' | 'medicine'>('generic');
  const [genericFormula, setGenericFormula] = useState('amoxicillin');
  const [medicineId, setMedicineId] = useState('');
  const [params, setParams] = useState<SearchParams | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const medicines = useQuery({
    queryKey: ['medicines', 'list'],
    queryFn: () => medicinesApi.list({ limit: 200 }),
  });

  const search = useQuery({
    queryKey: ['search', params],
    queryFn: () => medicinesApi.search(params as SearchParams),
    enabled: params !== null,
  });

  const useMyLocation = () => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not available in this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLon(pos.coords.longitude.toFixed(6));
      },
      (err) => setGeoError(err.message),
    );
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setParams({
      lat: Number(lat),
      lon: Number(lon),
      radiusKm: Number(radiusKm),
      limit: 25,
      ...(mode === 'generic'
        ? { genericFormula: genericFormula.trim() }
        : { medicineId: medicineId || undefined }),
    });
  };

  return (
    <div>
      <PageHeader
        title="Find a critical medicine"
        subtitle="Search verified pharmacies near you with stock available right now."
      />

      <Card className="mb-6">
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Latitude">
            <TextInput
              inputMode="decimal"
              required
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </Field>
          <Field label="Longitude">
            <TextInput
              inputMode="decimal"
              required
              value={lon}
              onChange={(e) => setLon(e.target.value)}
            />
          </Field>
          <Field label="Radius (km)">
            <TextInput
              type="number"
              min={1}
              max={50}
              required
              value={radiusKm}
              onChange={(e) => setRadiusKm(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button type="button" variant="ghost" className="w-full" onClick={useMyLocation}>
              Use my location
            </Button>
          </div>

          <Field label="Search by">
            <Select value={mode} onChange={(e) => setMode(e.target.value as 'generic' | 'medicine')}>
              <option value="generic">Generic formula (allows substitution)</option>
              <option value="medicine">Specific medicine</option>
            </Select>
          </Field>

          {mode === 'generic' ? (
            <Field label="Generic formula">
              <TextInput
                required
                placeholder="e.g. amoxicillin"
                value={genericFormula}
                onChange={(e) => setGenericFormula(e.target.value)}
              />
            </Field>
          ) : (
            <Field label="Medicine">
              <Select
                required
                value={medicineId}
                onChange={(e) => setMedicineId(e.target.value)}
              >
                <option value="">Select…</option>
                {medicines.data?.medicines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.brand ? `(${m.brand})` : ''} · {m.strength} · {m.form}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="flex items-end sm:col-span-2 lg:col-span-2">
            <Button type="submit" className="w-full" loading={search.isFetching}>
              Search
            </Button>
          </div>
        </form>

        {geoError && (
          <div className="mt-3">
            <Alert kind="info">{geoError}</Alert>
          </div>
        )}
      </Card>

      {search.isError && <Alert>{errorMessage(search.error)}</Alert>}

      {search.isFetching && (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <Spinner /> Searching nearby pharmacies…
        </div>
      )}

      {search.data && !search.isFetching && (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {search.data.count} result{search.data.count === 1 ? '' : 's'} within{' '}
            {search.data.query.radiusKm} km
          </p>
          {search.data.results.length === 0 ? (
            <EmptyState>No pharmacy nearby has this in stock. Try a wider radius.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {search.data.results.map((result) => (
                <ResultRow
                  key={result.inventoryId}
                  result={result}
                  onHeld={(id) => navigate(`/reservations/${id}`)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function ResultRow({
  result,
  onHeld,
}: {
  result: SearchResult;
  onHeld: (reservationId: string) => void;
}) {
  const [quantity, setQuantity] = useState('1');

  const hold = useMutation({
    mutationFn: reservationsApi.hold,
    onSuccess: (data) => onHeld(data.reservation.id),
  });

  const maxQty = Math.min(result.availableStock, 5);

  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">
                {result.medicine.name}
                {result.medicine.brand ? ` · ${result.medicine.brand}` : ''}
              </h3>
              {result.medicine.isCritical && <Badge>CRITICAL</Badge>}
            </div>
            <p className="text-sm text-slate-600">
              {result.medicine.strength} · {result.medicine.form} · {result.medicine.genericFormula}
            </p>
            <p className="mt-2 text-sm font-medium text-slate-800">{result.pharmacy.name}</p>
            <p className="text-sm text-slate-500">{result.pharmacy.address}</p>
            <p className="text-sm text-slate-500">☎ {result.pharmacy.phone}</p>
          </div>

          <div className="text-right">
            <p className="text-lg font-bold text-slate-900">{formatMoney(result.price)}</p>
            <p className="text-sm text-slate-500">{formatDistance(result.distanceKm)} away</p>
            <p className="text-sm text-emerald-700">{result.availableStock} available</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
          <label className="text-sm">
            <span className="label">Quantity</span>
            <input
              type="number"
              className="input w-24"
              min={1}
              max={maxQty}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <Button
            loading={hold.isPending}
            onClick={() =>
              hold.mutate({
                inventoryId: result.inventoryId,
                quantity: Math.max(1, Math.min(maxQty, Number(quantity) || 1)),
              })
            }
          >
            Hold for 30 min
          </Button>
          {hold.isError && (
            <span className="text-sm text-rose-600">{errorMessage(hold.error)}</span>
          )}
        </div>
      </Card>
    </li>
  );
}
