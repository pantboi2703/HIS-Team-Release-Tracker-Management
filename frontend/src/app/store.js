import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { rttApi } from '../api/rttApi.js';
import session from './sessionSlice.js';

export const store = configureStore({
  reducer: {
    session,
    [rttApi.reducerPath]: rttApi.reducer,
  },
  middleware: (getDefault) => getDefault().concat(rttApi.middleware),
});

setupListeners(store.dispatch);
