import { Shapes, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, Empty, IconButton, Input, Notice, Section, cx } from '@/components/ui';
import { AoiImportError, readAoiFile } from '@/map/aoiImport';
import { areaKm2, useStudyAreas } from '@/state/studyArea';

const fmtArea = (km2: number) => (km2 >= 100 ? `${Math.round(km2).toLocaleString()} km²` : `${km2.toFixed(1)} km²`);

export function StudyAreaPanel() {
  const { areas, activeId, add, update, remove, setActive } = useStudyAreas();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const features = await readAoiFile(file);
      features.forEach((f, i) =>
        add({
          id: crypto.randomUUID(),
          name: String(f.properties?.name || (features.length > 1 ? `${file.name} #${i + 1}` : file.name)),
          source: 'upload',
          geometry: f.geometry,
          bufferKm: f.geometry.type.includes('Point') || f.geometry.type.includes('Line') ? 5 : 0,
        }),
      );
    } catch (err) {
      setError(err instanceof AoiImportError ? err.message : 'The file could not be read.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <Section
      eyebrow="Step 1"
      title="Study area"
      actions={
        <>
          <Button variant="ghost" icon={Upload} onClick={() => fileInput.current?.click()}>
            Upload
          </Button>
          <input ref={fileInput} type="file" accept=".geojson,.json,.kml,.zip" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}

      {areas.length === 0 ? (
        <Empty icon={Shapes}>
          <p>Draw on the map with the tools at its top left, or upload GeoJSON, KML or a zipped Shapefile.</p>
        </Empty>
      ) : (
        <ul className="divide-y divide-line">
          {areas.map((a) => {
            const isPoint = a.geometry.type.includes('Point') || a.geometry.type.includes('Line');
            const active = a.id === activeId;
            return (
              <li key={a.id} className="py-2">
                <div className="flex items-center gap-3">
                  <input type="radio" name="active-area" aria-label={`Use ${a.name}`} checked={active} onChange={() => setActive(a.id)} />
                  <input
                    value={a.name}
                    onChange={(e) => update(a.id, { name: e.target.value })}
                    aria-label="Area name"
                    className={cx(
                      'h-9 min-w-0 flex-1 rounded-ui border border-transparent bg-transparent px-2 text-body hover:border-line-strong focus-visible:border-accent',
                      active ? 'text-ink' : 'text-ink-2',
                    )}
                  />
                  <span className="tabular text-meta text-ink-3">{fmtArea(areaKm2(a))}</span>
                  <IconButton icon={Trash2} label={`Delete ${a.name}`} tone="danger" onClick={() => remove(a.id)} />
                </div>
                {isPoint && (
                  <label className="mt-2 ml-7 flex items-center gap-3 text-meta text-ink-2">
                    Buffer
                    <Input
                      type="number"
                      min={0.1}
                      max={200}
                      step={0.5}
                      value={a.bufferKm}
                      onChange={(e) => update(a.id, { bufferKm: Math.max(0, Number(e.target.value)) })}
                      className="h-9 w-20"
                    />
                    km
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
