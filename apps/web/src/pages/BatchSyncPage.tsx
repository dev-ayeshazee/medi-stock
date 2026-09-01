import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../api/inventory';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../lib/api';
import { Alert, Button, Card, Field, PageHeader, Select, TextArea, TextInput } from '../components/ui';

const JSON_SAMPLE = `[
  {
    "sku": "A-500-KAMOX",
    "medicineName": "Amoxicillin",
    "genericFormula": "amoxicillin",
    "strength": "500mg",
    "form": "capsule",
    "brand": "Kamox",
    "totalStock": 140,
    "priceCents": 45000,
    "currency": "PKR"
  }
]`;

const CSV_SAMPLE = `sku,medicineName,genericFormula,strength,form,brand,totalStock,priceCents,currency
A-500-KAMOX,Amoxicillin,amoxicillin,500mg,capsule,Kamox,140,45000,PKR`;

function newBatchId(): string {
  return `pos-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function BatchSyncPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const queryClient = useQueryClient();

  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [batchId, setBatchId] = useState(newBatchId);
  const [pharmacyId, setPharmacyId] = useState('');
  const [text, setText] = useState(JSON_SAMPLE);

  const sync = useMutation({
    mutationFn: async () => {
      if (format === 'csv') {
        return inventoryApi.batchSyncCsv(text, {
          batchId,
          pharmacyId: isAdmin && pharmacyId ? pharmacyId : undefined,
        });
      }
      const items = JSON.parse(text);
      return inventoryApi.batchSyncJson({
        batchId,
        pharmacyId: isAdmin && pharmacyId ? pharmacyId : undefined,
        items,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setBatchId(newBatchId());
    },
  });

  const parseError = useMemo(() => {
    if (format !== 'json') return null;
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return 'JSON must be an array of items';
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid JSON';
    }
  }, [format, text]);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((content) => {
      setText(content);
      setFormat(file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json');
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    sync.mutate();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Batch inventory sync"
        subtitle="Idempotent bulk upsert. Re-sending the same batch ID is a safe no-op."
      />

      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Batch ID" hint="Stable, client-generated. Regenerated after each success.">
              <TextInput required value={batchId} onChange={(e) => setBatchId(e.target.value)} />
            </Field>
            <Field label="Payload format">
              <Select value={format} onChange={(e) => setFormat(e.target.value as 'json' | 'csv')}>
                <option value="json">JSON array</option>
                <option value="csv">CSV</option>
              </Select>
            </Field>
          </div>

          {isAdmin && (
            <Field label="Target pharmacy ID" hint="Required for admins; pharmacists sync their own.">
              <TextInput
                required
                value={pharmacyId}
                onChange={(e) => setPharmacyId(e.target.value)}
              />
            </Field>
          )}

          <Field label={format === 'json' ? 'Items (JSON array)' : 'CSV (with header row)'}>
            <TextArea
              rows={14}
              required
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".json,.csv,text/csv,application/json"
              onChange={onFile}
              className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
            />
            <button
              type="button"
              className="text-xs font-semibold text-brand-700 hover:underline"
              onClick={() => setText(format === 'json' ? JSON_SAMPLE : CSV_SAMPLE)}
            >
              Load sample
            </button>
          </div>

          {parseError && <Alert kind="info">JSON: {parseError}</Alert>}
          {sync.isError && <Alert>{errorMessage(sync.error)}</Alert>}
          {sync.data && (
            <Alert kind="success">
              {sync.data.status === 'ALREADY_PROCESSED'
                ? `Batch ${sync.data.batchId} was already processed — no changes.`
                : `Processed ${sync.data.processed} item(s), skipped ${sync.data.skipped}.`}
            </Alert>
          )}

          <Button
            type="submit"
            loading={sync.isPending}
            disabled={Boolean(parseError)}
          >
            Run sync
          </Button>
        </form>
      </Card>
    </div>
  );
}
