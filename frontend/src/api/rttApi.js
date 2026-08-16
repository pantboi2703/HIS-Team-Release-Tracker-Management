import { createApi } from '@reduxjs/toolkit/query/react';
import { baseQuery } from './client.js';

export const rttApi = createApi({
  reducerPath: 'rtt',
  baseQuery,
  tagTypes: ['Cycle', 'Run', 'Issue', 'User', 'Stats', 'Me'],
  endpoints: (b) => ({
    // ---- auth ----
    login: b.mutation({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
    }),
    me: b.query({ query: () => '/auth/me', providesTags: ['Me'] }),

    // ---- cycles ----
    cycles: b.query({
      query: (params = {}) => `/cycles?${new URLSearchParams(params)}`,
      providesTags: ['Cycle'],
    }),
    cycle: b.query({
      query: (id) => `/cycles/${id}`,
      providesTags: (r, e, id) => [{ type: 'Cycle', id }],
    }),
    createCycle: b.mutation({
      query: (body) => ({ url: '/cycles', method: 'POST', body }),
      invalidatesTags: ['Cycle'],
    }),
    updateCycle: b.mutation({
      query: ({ id, ...body }) => ({ url: `/cycles/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Cycle', 'Run', 'Stats'],
    }),
    closeCheck: b.query({ query: (id) => `/cycles/${id}/close-check` }),

    // ---- runs ----
    runs: b.query({
      query: (params = {}) => {
        const clean = Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null),
        );
        return `/runs?${new URLSearchParams(clean)}`;
      },
      providesTags: ['Run'],
    }),
    run: b.query({
      query: (id) => `/runs/${id}`,
      providesTags: (r, e, id) => [{ type: 'Run', id }],
    }),

    updateRun: b.mutation({
      query: ({ id, ...body }) => ({ url: `/runs/${id}`, method: 'PATCH', body }),
      // Optimistic update: the cell changes the instant the person acts, and
      // rolls back with a toast on failure. This is what makes it feel faster
      // than Excel, which is the actual competitor (spec §14.1).
      async onQueryStarted({ id, listArgs, ...patch }, { dispatch, queryFulfilled }) {
        const undos = [];
        if (listArgs) {
          undos.push(
            dispatch(
              rttApi.util.updateQueryData('runs', listArgs, (draft) => {
                const row = draft.items.find((r) => r._id === id);
                if (row) Object.assign(row, patch, { version: row.version + 1 });
              }),
            ),
          );
        }
        try {
          await queryFulfilled;
        } catch {
          undos.forEach((u) => u.undo());
        }
      },
      invalidatesTags: ['Stats', 'Issue'],
    }),

    openNextRound: b.mutation({
      query: ({ id, ...body }) => ({ url: `/runs/${id}/open-next-round`, method: 'POST', body }),
      invalidatesTags: ['Run', 'Stats', 'Issue', 'Cycle'],
    }),
    bulkUpdate: b.mutation({
      query: (body) => ({ url: '/runs/bulk-update', method: 'POST', body }),
      invalidatesTags: ['Run', 'Stats', 'Issue', 'Cycle'],
    }),
    runHistory: b.query({ query: (id) => `/runs/${id}/history` }),

    // ---- issues ----
    issue: b.query({
      query: (rm) => `/issues/${rm}`,
      providesTags: (r, e, rm) => [{ type: 'Issue', id: rm }],
    }),

    // ---- stats ----
    stats: b.query({
      query: ({ id, mode = 'issue' }) => `/cycles/${id}/stats?mode=${mode}`,
      providesTags: ['Stats'],
    }),

    // ---- carry forward ----
    carryForwardPreview: b.query({ query: (id) => `/cycles/${id}/carry-forward/preview` }),
    carryForward: b.mutation({
      query: ({ id, ...body }) => ({ url: `/cycles/${id}/carry-forward`, method: 'POST', body }),
      invalidatesTags: ['Cycle', 'Run', 'Stats'],
    }),

    // ---- users ----
    users: b.query({ query: () => '/users', providesTags: ['User'] }),
    createUser: b.mutation({
      query: (body) => ({ url: '/users', method: 'POST', body }),
      invalidatesTags: ['User'],
    }),
    updateUser: b.mutation({
      query: ({ id, ...body }) => ({ url: `/users/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['User'],
    }),

    // ---- personal ----
    mySummary: b.query({ query: () => '/me/summary', providesTags: ['Run'] }),

    // ---- import ----
    importBatches: b.query({ query: () => '/import/batches' }),
    // Multipart, so the same call works against FastAPI's UploadFile in
    // Phase 2 and against the mock parser in Phase 1.
    importPreview: b.mutation({
      query: ({ file, sheet, cycleId }) => {
        const form = new FormData();
        if (file) form.append('file', file, file.name);
        if (sheet) form.append('sheet', sheet);
        if (cycleId) form.append('cycle_id', cycleId);
        return { url: '/import/preview', method: 'POST', body: form };
      },
    }),
    importCommit: b.mutation({
      query: (body) => ({ url: '/import/commit', method: 'POST', body }),
      invalidatesTags: ['Cycle', 'Run'],
    }),

    // ---- export ----
    exportCycle: b.mutation({
      query: (id) => ({ url: `/cycles/${id}/export`, method: 'GET' }),
    }),
  }),
});

export const {
  useLoginMutation,
  useMeQuery,
  useCyclesQuery,
  useCycleQuery,
  useCreateCycleMutation,
  useUpdateCycleMutation,
  useCloseCheckQuery,
  useRunsQuery,
  useRunQuery,
  useUpdateRunMutation,
  useOpenNextRoundMutation,
  useBulkUpdateMutation,
  useRunHistoryQuery,
  useIssueQuery,
  useStatsQuery,
  useCarryForwardPreviewQuery,
  useCarryForwardMutation,
  useUsersQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useMySummaryQuery,
  useImportBatchesQuery,
  useImportPreviewMutation,
  useImportCommitMutation,
  useExportCycleMutation,
} = rttApi;
