import { useSearchForm } from '@/state/searchForm';
import { useStudyAreas } from '@/state/studyArea';
import { db, resolvePeriod, type SavedSearch } from '@/storage/db';

type Runnable = Pick<SavedSearch, 'productKey' | 'area' | 'period' | 'cycle' | 'pass'> & { id?: string };

/** Load a saved (or history) search into the form and run it; clears its "new" count. */
export function useRunSavedSearch() {
  const addArea = useStudyAreas((s) => s.add);
  const form = useSearchForm();
  return (s: Runnable) => {
    const { start, end } = resolvePeriod(s.period);
    addArea(s.area); // re-adds (or refreshes) the area and makes it active
    form.set({
      productKey: s.productKey,
      start,
      end,
      cycle: s.cycle !== undefined ? String(s.cycle) : '',
      pass: s.pass !== undefined ? String(s.pass) : '',
    });
    form.requestRun();
    if (s.id) void db.savedSearches.update(s.id, { lastRunAt: Date.now(), newCount: 0 });
  };
}
