import { createSlice } from '@reduxjs/toolkit';

// Session state lives in memory only — no browser storage anywhere (spec §14.5).
const slice = createSlice({
  name: 'session',
  initialState: {
    user: null,
    cycleId: null,
    toasts: [],
    conflict: null, // 409 payload waiting for the person to choose a side
  },
  reducers: {
    signedIn(state, { payload }) {
      state.user = payload.user;
    },
    signedOut(state) {
      state.user = null;
      state.cycleId = null;
      state.toasts = [];
      state.conflict = null;
    },
    // Demo-only: switch role without logging out, so all three views can be
    // shown in one sitting.
    switchedUser(state, { payload }) {
      state.user = payload;
    },
    cycleSelected(state, { payload }) {
      state.cycleId = payload;
    },
    toastPushed: {
      reducer(state, { payload }) {
        state.toasts.push(payload);
        if (state.toasts.length > 4) state.toasts.shift();
      },
      prepare(text, kind = 'ok') {
        return { payload: { id: `${Date.now()}-${Math.random()}`, text, kind } };
      },
    },
    toastDismissed(state, { payload }) {
      state.toasts = state.toasts.filter((t) => t.id !== payload);
    },
    conflictRaised(state, { payload }) {
      state.conflict = payload;
    },
    conflictCleared(state) {
      state.conflict = null;
    },
  },
});

export const {
  signedIn,
  signedOut,
  switchedUser,
  cycleSelected,
  toastPushed,
  toastDismissed,
  conflictRaised,
  conflictCleared,
} = slice.actions;

export default slice.reducer;
