import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '../api/inventory';
import { pharmaciesApi } from '../api/pharmacies';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import {
  Alert,
  Badge,
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

export function InventoryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [pharmacyId, setPharmacyId] = useState('');

  const pharmacies = useQuery({
    queryKey: ['pharmacies'],
    queryFn: pharmaciesApi.list,
    enabled: isAdmin,
  });

  const inventory = useQuery({
    queryKey: ['inventory', pharmacyId || 'self'],
    queryFn: () => inventoryApi.list(pharmacyId ? { pharmacyId, limit: 1000 } : { limit: 1000 }),
    enabled: !isAdmin || Boolean(pharmacyId),
  });

  const [q, setQ] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'available' | 'out'>('all');

  const filtered = useMemo(() => {
    const items = inventory.data?.items ?? [];
    const needle = q.trim().toLowerCase();
    return items.filter((item) => {
      if (stockFilter === 'available' && item.availableStock <= 0) return false;
      if (stockFilter === 'out' && item.availableStock > 0) return false;
      if (!needle) return true;
      return (
        item.sku.toLowerCase().includes(needle) ||
        item.medicine.name.toLowerCase().includes(needle) ||
        (item.medicine.brand ?? '').toLowerCase().includes(needle) ||
        item.medicine.genericFormula.toLowerCase().includes(needle)
      );
    });
  }, [inventory.data, q, stockFilter]);

  const paged = usePaged(filtered, 15);

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Current stock lines. Available = total − held."
      />

      {isAdmin && (
        <Card className="mb-6 max-w-md">
          <Field label="Pharmacy">
            <Select value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)}>
              <option value="">Select a pharmacy…</option>
              {pharmacies.data?.pharmacies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.status})
                </option>
              ))}
            </Select>
          </Field>
        </Card>
      )}

      {isAdmin && !pharmacyId && <EmptyState>Pick a pharmacy to view its inventory.</EmptyState>}

      {inventory.isLoading && (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <Spinner /> Loading inventory…
        </div>
      )}
      {inventory.isError && <Alert>{errorMessage(inventory.error)}</Alert>}

      {inventory.data && inventory.data.items.length === 0 && (
        <EmptyState>
          No inventory yet.{' '}
          <Link to="/inventory/sync" className="font-semibold text-brand-700 hover:underline">
            Run a batch sync
          </Link>
          .
        </EmptyState>
      )}

      {inventory.data && inventory.data.items.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <TextInput
              className="input max-w-xs"
              placeholder="Search SKU / medicine / brand…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select
              className="input max-w-[12rem]"
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as 'all' | 'available' | 'out')}
            >
              <option value="all">All stock states</option>
              <option value="available">Available only</option>
              <option value="out">Out of stock only</option>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState>No lines match the filter.</EmptyState>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">SKU</th>
                      <th className="px-4 py-3">Medicine</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-right">Held</th>
                      <th className="px-4 py-3 text-right">Available</th>
                      <th className="px-4 py-3 text-right">Price</th>
                      <th className="px-4 py-3">Last synced</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paged.slice.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.sku}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800">{item.medicine.name}</span>
                      {item.medicine.brand ? ` · ${item.medicine.brand}` : ''}
                      {item.medicine.isCritical && (
                        <span className="ml-2">
                          <Badge>CRITICAL</Badge>
                        </span>
                      )}
                      <span className="block text-xs text-slate-500">
                        {item.medicine.strength} · {item.medicine.form}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{item.totalStock}</td>
                    <td className="px-4 py-3 text-right text-amber-700">{item.heldStock}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                      {item.availableStock}
                    </td>
                    <td className="px-4 py-3 text-right">{formatMoney(item.price)}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatDateTime(item.lastSyncedAt)}
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
          )}
        </>
      )}
    </div>
  );
}
