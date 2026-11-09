import { create } from 'zustand';
import { isoDate } from '@/lib/format';

/**
 * Search form state, shared so that saved searches and history can fill it in
 * and trigger a run (by bumping `runRequest`).
 */
interface SearchFormState {
  productKey: string;
  start: string;
  end: string;
  cycle: string;
  pass: string;
  runRequest: number;
  set: (patch: Partial<Omit<SearchFormState, 'set' | 'requestRun'>>) => void;
  requestRun: () => void;
}

export const useSearchForm = create<SearchFormState>((set) => ({
  productKey: 'lake-prior',
  start: isoDate(new Date(Date.now() - 90 * 86_400_000)),
  end: isoDate(new Date()),
  cycle: '',
  pass: '',
  runRequest: 0,
  set: (patch) => set(patch),
  requestRun: () => set((s) => ({ runRequest: s.runRequest + 1 })),
}));
