// The swap point between Phase 1 and Phase 2.
//
// VITE_USE_MOCK=true  -> every request is served by the in-memory mock server.
// VITE_USE_MOCK=false -> every request goes to the FastAPI backend.
//
// Nothing else in the app knows which of the two is running. Changing phases is
// this one file, not a rewrite.

import { fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { mockRequest } from './mockServer.js';

export const USE_MOCK = String(import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false';
export const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// The access token lives in memory only. No localStorage, no sessionStorage,
// no browser storage API anywhere in this app (spec §14.5). The refresh token
// is an httpOnly cookie the JS never sees.
let accessToken = null;
export const setAccessToken = (t) => {
  accessToken = t;
};
export const getAccessToken = () => accessToken;

const realBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE,
  credentials: 'include',
  prepareHeaders: (headers) => {
    if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
    return headers;
  },
});

async function mockBaseQuery(args) {
  const { url, method = 'GET', body } = typeof args === 'string' ? { url: args } : args;
  try {
    const data = await mockRequest({ url, method, body, token: accessToken });
    return { data };
  } catch (err) {
    return { error: { status: err.status || 500, data: err.data || { detail: String(err.message) } } };
  }
}

export const baseQuery = USE_MOCK ? mockBaseQuery : realBaseQuery;
