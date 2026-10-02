'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Check, FileUp, Loader2 } from 'lucide-react';
import {
  CONTACT_FIELD_LABEL,
  CUSTOM_FIELD_PREFIX,
  IMPORT_CHUNK_ROWS,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROWS,
  IMPORTABLE_FIELDS,
  formatBytes,
  parseCsv,
  suggestMapping,
  type ContactList,
} from '@landcaller/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import {
  commitImportChunk,
  finishImportJob,
  previewImportChunk,
  startImportJob,
  type ImportResult,
} from '@/lib/actions/contacts';
import type { Facets } from '@/lib/contacts/facets';

interface Parsed {
  columns: string[];
  rows: string[][];
  sample: string[][];
  sheets?: string[];
}

type Step = 'upload' | 'map' | 'done';
type Strategy = 'update' | 'skip' | 'create';

/** Mappings are remembered by the shape of the header row, so a vendor's second file maps itself. */
const mappingKey = (columns: string[]) => `lc:import-mapping:${columns.map((c) => c.trim().toLowerCase()).join('|')}`;

/** Preview is sampled: enough chunks to be representative, not the whole 400,000 rows. */
const PREVIEW_CHUNKS = 10;

/**
 * CNT-12 / CNT-37 → CNT-41 — the import wizard.
 *
 * Three steps: pick a file, confirm the mapping and the options, commit. The file is parsed
 * in the browser — CSV by our own parser, Excel by SheetJS — and uploaded a chunk at a time
 * against a job the API opened first, so a 50 MB file never travels whole and the result is
 * on record whether or not the tab survives. A mapping, once confirmed, is remembered for
 * the next file with the same header row.
 */
export function ImportWizard({ accountId, facets, lists }: { accountId: string; facets: Facets; lists: ContactList[] }) {
  const [step, setStep] = React.useState<Step>('upload');
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [rawFile, setRawFile] = React.useState<File | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [remembered, setRemembered] = React.useState(false);

  const [tag, setTag] = React.useState('');
  const [listId, setListId] = React.useState('');
  const [ownerId, setOwnerId] = React.useState('');
  const [strategy, setStrategy] = React.useState<Strategy>('update');

  const [preview, setPreview] = React.useState<{ matched: number; unmatched: number; nameless: number; sampled: number } | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = React.useState<(ImportResult & { jobId: string }) | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const fieldOptions = [
    ...IMPORTABLE_FIELDS.map((f) => ({ value: f, label: CONTACT_FIELD_LABEL[f] ?? f })),
    ...facets.fields.map((f) => ({ value: `${CUSTOM_FIELD_PREFIX}${f.key}`, label: `${f.label} (custom)` })),
  ];

  async function readFile(file: File, sheet?: string): Promise<Parsed> {
    if (/\.xlsx?$/i.test(file.name)) {
      // Loaded on demand: most imports are CSV and the workbook parser is not small.
      const XLSX = await import('xlsx');
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const name = sheet ?? book.SheetNames[0]!;
      const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, { header: 1, raw: false, defval: '' });
      const [header = [], ...body] = grid;
      const columns = header.map((c) => String(c ?? '').trim());
      const rows = body
        .map((r) => columns.map((_, i) => String(r[i] ?? '').trim()))
        .filter((r) => r.some((c) => c !== ''));
      return { columns, rows, sample: rows.slice(0, 8), sheets: book.SheetNames };
    }
    const csv = parseCsv(await file.text());
    return { columns: csv.columns, rows: csv.rows, sample: csv.rows.slice(0, 8) };
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPreview(null);

    if (file.size > IMPORT_MAX_FILE_BYTES) {
      return setError(`That file is ${formatBytes(file.size)}. The limit is ${formatBytes(IMPORT_MAX_FILE_BYTES)} — split it and import in batches.`);
    }

    let data: Parsed;
    try {
      data = await readFile(file);
    } catch (err) {
      return setError(err instanceof Error ? `Could not read that file: ${err.message}` : 'Could not read that file.');
    }

    if (data.columns.length === 0) return setError('That file has no header row.');
    if (data.rows.length === 0) return setError('That file has a header but no data rows.');
    if (data.rows.length > IMPORT_MAX_ROWS) {
      return setError(`That file has ${data.rows.length.toLocaleString()} rows. One import can take ${IMPORT_MAX_ROWS.toLocaleString()} — split it and import in batches.`);
    }

    let saved: Record<string, string> | null = null;
    try {
      const raw = window.localStorage.getItem(mappingKey(data.columns));
      saved = raw ? (JSON.parse(raw) as Record<string, string>) : null;
    } catch {
      saved = null;
    }
    const valid = new Set(fieldOptions.map((o) => o.value));
    const usable = saved && Object.values(saved).every((v) => v === '' || valid.has(v)) ? saved : null;

    setMapping(usable ?? suggestMapping(data.columns));
    setRemembered(Boolean(usable));
    setParsed(data);
    setRawFile(file);
    setFileName(file.name);
    setStep('map');
  }

  async function switchSheet(name: string) {
    if (!rawFile) return;
    const data = await readFile(rawFile, name);
    setParsed(data);
    setMapping(suggestMapping(data.columns));
    setPreview(null);
  }

  /** Sample the file against existing contacts so the counts are known before anything is written. */
  async function runPreview() {
    if (!parsed) return;
    setPreviewing(true);
    setError(null);
    const totals = { matched: 0, unmatched: 0, nameless: 0, sampled: 0 };
    const limit = Math.min(parsed.rows.length, PREVIEW_CHUNKS * IMPORT_CHUNK_ROWS);
    for (let offset = 0; offset < limit; offset += IMPORT_CHUNK_ROWS) {
      const rows = parsed.rows.slice(offset, Math.min(offset + IMPORT_CHUNK_ROWS, limit));
      const res = await previewImportChunk(accountId, { columns: parsed.columns, rows, mapping });
      if (!res.ok) {
        setError(res.error);
        break;
      }
      totals.matched += res.data.matched;
      totals.unmatched += res.data.unmatched;
      totals.nameless += res.data.nameless;
      totals.sampled += rows.length;
    }
    setPreview(totals);
    setPreviewing(false);
  }

  /**
   * Send the file a chunk at a time, accumulating what each one reports.
   *
   * Sequential rather than parallel: the import matches rows against contacts already in
   * the database, and two chunks describing the same person in flight at once would each
   * see "not there yet" and insert a duplicate.
   */
  function commit() {
    if (!parsed) return;
    setError(null);

    startTransition(async () => {
      const total = parsed.rows.length;
      const opened = await startImportJob(accountId, {
        fileName,
        tag: tag.trim() || undefined,
        listId: listId || undefined,
        ownerId: ownerId || undefined,
        strategy,
        mapping,
        totalRows: total,
      });
      if (!opened.ok) return setError(opened.error);
      const jobId = opened.data.id;

      try {
        window.localStorage.setItem(mappingKey(parsed.columns), JSON.stringify(mapping));
      } catch {
        // Fine without.
      }

      const totals: ImportResult & { jobId: string } = { created: 0, updated: 0, skipped: 0, errors: [], errorCount: 0, total, jobId };
      setProgress({ done: 0, total });

      for (let offset = 0; offset < total; offset += IMPORT_CHUNK_ROWS) {
        const rows = parsed.rows.slice(offset, offset + IMPORT_CHUNK_ROWS);
        const res = await commitImportChunk(accountId, { columns: parsed.columns, rows, mapping, jobId, offset });

        if (!res.ok) {
          // Everything before this chunk is already written, which is safe under "update":
          // re-running the same file updates rather than duplicating. Saying so is better
          // than a silent partial import.
          await finishImportJob(accountId, jobId, 'failed');
          setProgress(null);
          setError(
            offset === 0
              ? res.error
              : `${res.error} ${offset.toLocaleString()} of ${total.toLocaleString()} rows were imported before this failed. ` +
                (strategy === 'update' ? 'Re-running the same file will finish it without creating duplicates.' : 'Undo this import from Settings → Imports before re-running it.'),
          );
          return;
        }

        totals.created += res.data.created;
        totals.updated += res.data.updated;
        totals.skipped += res.data.skipped;
        totals.errorCount += res.data.errorCount;
        totals.errors.push(...res.data.errors);
        setProgress({ done: Math.min(offset + rows.length, total), total });
      }

      await finishImportJob(accountId, jobId, 'finished');
      totals.errors = totals.errors.slice(0, 50);
      setProgress(null);
      setResult(totals);
      setStep('done');
    });
  }

  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const hasName = Object.values(mapping).some((f) => f === 'firstName' || f === 'lastName');

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-subtle px-3 py-2.5">
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-[13px] text-danger">{error}</p>
        </div>
      )}

      {step === 'upload' && (
        <Card>
          <CardBody>
            <label htmlFor="import-file" className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border-strong px-6 py-14 text-center transition-colors hover:border-brand hover:bg-brand-subtle/30">
              {pending ? <Loader2 size={22} className="mb-3 animate-spin text-fg-subtle" /> : <FileUp size={22} className="mb-3 text-fg-subtle" />}
              <span className="text-sm font-medium text-fg">{pending ? 'Reading file…' : 'Choose a CSV or Excel file'}</span>
              <span className="mt-1 text-[13px] text-fg-muted">Owner lists exported from Zoho, GHL or a skip-trace provider</span>
              <input id="import-file" type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} disabled={pending} className="sr-only" />
            </label>
          </CardBody>
        </Card>
      )}

      {step === 'map' && parsed && (
        <>
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Match your columns</CardTitle>
              <span className="tabular text-[12px] text-fg-subtle">
                {parsed.rows.length.toLocaleString()} rows · {mappedCount} of {parsed.columns.length} columns mapped
                {remembered && ' · mapping remembered from last time'}
              </span>
            </CardHeader>
            <CardBody className="space-y-2">
              {parsed.sheets && parsed.sheets.length > 1 && (
                <div className="mb-3 flex items-center gap-2">
                  <Label htmlFor="sheet" className="mb-0">Sheet</Label>
                  <Select id="sheet" defaultValue={parsed.sheets[0]} onChange={(e) => switchSheet(e.target.value)} className="w-auto">
                    {parsed.sheets.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {parsed.columns.map((column, i) => (
                <div key={`${column}-${i}`} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-fg">{column || <span className="text-fg-subtle">(blank header)</span>}</p>
                    <p className="truncate text-[11px] text-fg-subtle">e.g. {parsed.sample[0]?.[i] || '—'}</p>
                  </div>
                  <Select value={mapping[column] ?? ''} onChange={(e) => { setMapping((m) => ({ ...m, [column]: e.target.value })); setPreview(null); }} className="w-56 shrink-0" aria-label={`Map column ${column}`}>
                    <option value="">Skip this column</option>
                    {fieldOptions.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-left text-[12px]">
                  <thead className="border-b border-border bg-surface-2">
                    <tr className="text-[10px] uppercase tracking-wide text-fg-subtle">
                      {parsed.columns.map((c, i) => (
                        <th key={`${c}-${i}`} className="whitespace-nowrap px-3 py-2 font-medium">
                          {fieldOptions.find((f) => f.value === mapping[c])?.label || <span className="opacity-50">skipped</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.sample.map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        {row.map((cell, j) => (
                          <td key={j} className={`whitespace-nowrap px-3 py-1.5 ${mapping[parsed.columns[j] ?? ''] ? 'text-fg' : 'text-fg-subtle/50'}`}>
                            {cell || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Options</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="import-tag">Tag every imported contact (recommended)</Label>
                  <Input id="import-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="costilla-march-2026" />
                  <p className="mt-1 text-[11px] text-fg-subtle">A tag makes this batch easy to find and filter. The import itself can be undone from Settings → Imports.</p>
                </div>
                <div>
                  <Label htmlFor="import-strategy">When a row matches an existing contact</Label>
                  <Select id="import-strategy" value={strategy} onChange={(e) => { setStrategy(e.target.value as Strategy); }}>
                    <option value="update">Update the existing contact (recommended)</option>
                    <option value="skip">Skip the row</option>
                    <option value="create">Create a second record anyway</option>
                  </Select>
                  <p className="mt-1 text-[11px] text-fg-subtle">Matched by external id, then phone number, then email. Updating adds what the file knows and never erases, and never lifts a do-not-call.</p>
                </div>
                {lists.length > 0 && (
                  <div>
                    <Label htmlFor="import-list">Add every contact to a list</Label>
                    <Select id="import-list" value={listId} onChange={(e) => setListId(e.target.value)}>
                      <option value="">No list</option>
                      {lists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <div>
                  <Label htmlFor="import-owner">Assign new contacts to</Label>
                  <Select id="import-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                    <option value="">Nobody</option>
                    {facets.owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
                {preview ? (
                  <p className="text-[13px] text-fg">
                    Of {preview.sampled.toLocaleString()} rows{preview.sampled < parsed.rows.length ? ' sampled' : ''}:{' '}
                    <strong className="tabular">{preview.unmatched.toLocaleString()}</strong> will be created,{' '}
                    <strong className="tabular">{preview.matched.toLocaleString()}</strong> match an existing contact and will be{' '}
                    {strategy === 'update' ? 'updated' : strategy === 'skip' ? 'skipped' : 'created again'}
                    {preview.nameless > 0 && <>, {preview.nameless.toLocaleString()} have no name and will be skipped</>}.
                  </p>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] text-fg-muted">See how many rows will be created and how many match existing contacts before writing anything.</p>
                    <Button variant="outline" size="sm" onClick={runPreview} disabled={previewing || !hasName}>
                      {previewing ? 'Checking…' : 'Check matches'}
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <Button variant="ghost" size="sm" onClick={() => { setStep('upload'); setParsed(null); setPreview(null); }}>
                  Back
                </Button>
                <Button size="sm" onClick={commit} disabled={pending || !hasName}>
                  {pending ? 'Importing…' : `Import ${parsed.rows.length.toLocaleString()} rows`}
                </Button>
              </div>

              {progress && (
                <div role="status" aria-live="polite">
                  <div className="mb-1.5 flex items-center justify-between text-[12px]">
                    <span className="text-fg-muted">Importing {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows</span>
                    <span className="tabular text-fg-subtle">{Math.round((progress.done / progress.total) * 100)}%</span>
                  </div>
                  {/* Genuine progress: each chunk reports back before the next is sent. */}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  </div>
                </div>
              )}

              {!hasName && <p className="text-[12px] text-danger">Map at least a first or last name column before importing.</p>}
            </CardBody>
          </Card>
        </>
      )}

      {step === 'done' && result && (
        <Card>
          <CardBody>
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-subtle text-success">
                <Check size={16} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-fg">Import finished</h3>
                <p className="text-[12px] text-fg-subtle">{result.total.toLocaleString()} rows processed</p>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-3 gap-3">
              <Stat label="Created" value={result.created} tone="success" />
              <Stat label="Updated" value={result.updated} tone="info" />
              <Stat label="Skipped" value={result.skipped} tone="neutral" />
            </div>

            {result.errorCount > 0 && (
              <div className="mb-4 rounded-lg border border-warning/30 bg-warning-subtle p-3">
                <p className="mb-1.5 text-[13px] font-medium text-warning">
                  {result.errorCount} value{result.errorCount === 1 ? '' : 's'} could not be imported
                </p>
                <ul className="space-y-0.5">
                  {result.errors.slice(0, 8).map((e, i) => (
                    <li key={`${e.row}-${i}`} className="text-[12px] text-fg-muted">
                      {e.row ? `Row ${e.row}: ` : ''}{e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Link href={`/app/${accountId}/contacts${tag ? `?tags=${encodeURIComponent(tag)}` : ''}`}>
                <Button size="sm">View imported contacts</Button>
              </Link>
              <Link href={`/app/${accountId}/settings/imports`}>
                <Button variant="outline" size="sm">Import history</Button>
              </Link>
              <Button variant="outline" size="sm" onClick={() => { setStep('upload'); setParsed(null); setResult(null); setPreview(null); setTag(''); setFileName(''); }}>
                Import another file
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {step !== 'upload' && (
        <Link href={`/app/${accountId}/contacts`} className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted transition-colors hover:text-fg">
          <ArrowLeft size={13} /> Back to contacts
        </Link>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'success' | 'info' | 'neutral' }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <p className="tabular text-lg font-semibold text-fg">{value.toLocaleString()}</p>
      <Badge tone={tone}>{label}</Badge>
    </div>
  );
}
