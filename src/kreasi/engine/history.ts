'use client';

import * as React from 'react';

/** Changes this close together count as one step — a drag or a slider sweep. */
const COALESCE_MS = 500;
const LIMIT = 100;

interface State<T> {
  past: T[];
  present: T;
  future: T[];
}

/**
 * Undo/redo over an immutable value. Rapid successive updates are merged into a
 * single step, so one undo reverts a whole drag instead of its last pixel.
 */
export function useHistory<T>(initial: () => T) {
  const [state, setState] = React.useState<State<T>>(() => ({
    past: [],
    present: initial(),
    future: [],
  }));
  const lastChange = React.useRef(0);

  const update = React.useCallback((updater: (present: T) => T) => {
    // Decided outside the state updater, which React may run twice.
    const now = Date.now();
    const merge = now - lastChange.current < COALESCE_MS;
    lastChange.current = now;
    setState((s) => {
      const next = updater(s.present);
      if (next === s.present) return s;
      return {
        past: merge && s.past.length > 0 ? s.past : [...s.past, s.present].slice(-LIMIT),
        present: next,
        future: [],
      };
    });
  }, []);

  const undo = React.useCallback(() => {
    lastChange.current = 0;
    setState((s) =>
      s.past.length === 0
        ? s
        : {
            past: s.past.slice(0, -1),
            present: s.past[s.past.length - 1]!,
            future: [s.present, ...s.future],
          },
    );
  }, []);

  const redo = React.useCallback(() => {
    lastChange.current = 0;
    setState((s) =>
      s.future.length === 0
        ? s
        : { past: [...s.past, s.present], present: s.future[0]!, future: s.future.slice(1) },
    );
  }, []);

  /** Replace the value without an undo step — e.g. restoring a draft. */
  const reset = React.useCallback((value: T) => {
    lastChange.current = 0;
    setState({ past: [], present: value, future: [] });
  }, []);

  return {
    value: state.present,
    update,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
