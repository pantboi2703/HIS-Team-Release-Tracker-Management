import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { STATUSES, STATUS_LABEL, statusBg, statusFg } from '../api/domain.js';
import { toastDismissed } from '../app/sessionSlice.js';

export const Mono = ({ children, style, ...rest }) => (
  <span className="mono" style={style} {...rest}>
    {children}
  </span>
);

export function Pill({ status, style }) {
  return (
    <span className="pill" style={{ color: statusFg(status), background: statusBg(status), ...style }}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export function RoundChip({ round }) {
  return (
    <span className={`round-chip ${round > 1 ? 'rn' : 'r1'}`}>{round > 1 ? `r${round}` : '1'}</span>
  );
}

export function Banner({ kind = 'info', title, children, actions }) {
  return (
    <div className={`banner banner-${kind}`} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="grow">
        {title && <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600 }}>{title}</div>}
        {children && <div style={{ marginTop: title ? 2 : 0 }}>{children}</div>}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <div className="h2">{title}</div>
      {children && (
        <div className="soft" style={{ fontSize: 'var(--fs-12)', marginTop: 4 }}>
          {children}
        </div>
      )}
    </div>
  );
}

// The status dropdown carries the status colour (spec §11, My items).
export function StatusSelect({ value, onChange, disabled }) {
  return (
    <select
      className="status-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ color: statusFg(value), background: statusBg(value) }}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

const SS_VALUE = { true: 'Yes', false: 'No', null: '—' };

export function ShowstopperSelect({ value, onChange, disabled, labelled }) {
  const v = value === true ? 'Yes' : value === false ? 'No' : '—';
  return (
    <select
      className="stopper-select"
      value={v}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === 'Yes' ? true : e.target.value === 'No' ? false : null)}
      style={{
        color: value === true ? 'var(--danger)' : value === false ? 'var(--ink-soft)' : 'var(--muted)',
        fontWeight: value === true ? 600 : 400,
      }}
    >
      <option value="—">{labelled ? 'Stopper —' : '—'}</option>
      <option value="Yes">{labelled ? 'Stopper yes' : 'Yes'}</option>
      <option value="No">{labelled ? 'Stopper no' : 'No'}</option>
    </select>
  );
}

// Debounced inline text cell: types locally, commits on pause or blur, so an
// optimistic PATCH does not fire on every keystroke.
export function RemarkCell({ value, onCommit, disabled, placeholder = 'Add remark' }) {
  const [text, setText] = useState(value || '');
  const timer = useRef(null);
  const latest = useRef(value || '');

  useEffect(() => {
    if (value !== latest.current) {
      latest.current = value || '';
      setText(value || '');
    }
  }, [value]);

  const commit = (v) => {
    if (v === latest.current) return;
    latest.current = v;
    onCommit(v);
  };

  return (
    <input
      className="cell-input"
      value={text}
      disabled={disabled}
      placeholder={disabled ? '' : placeholder}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), 550);
      }}
      onBlur={() => {
        clearTimeout(timer.current);
        commit(text);
      }}
    />
  );
}

// A run with previous_run_id always renders this. Always. (spec §14.2)
export function PreviousRoundBanner({ prev, indent = 80 }) {
  if (!prev) return null;
  // The accent follows the previous verdict — a round that passed and is being
  // re-checked for regression should not read as an alarm.
  return (
    <div className="prev-banner" style={{ paddingLeft: indent, borderLeftColor: statusFg(prev.status) }}>
      <span className="tag">ROUND {prev.round}</span>
      <span className="soft" style={{ flex: 'none' }}>
        {prev.tester}
      </span>
      <Pill status={prev.status} style={{ fontSize: 'var(--fs-11)', padding: '1px 6px' }} />
      <span className="ellipsis" style={{ color: 'var(--ink)' }}>
        {prev.remark ? `“${prev.remark}”` : 'no remark'}
      </span>
      {!prev.same_cycle && (
        <span className="mono muted" style={{ fontSize: 'var(--fs-11)', flex: 'none' }}>
          {prev.cycle_name}
        </span>
      )}
      <span className="mono muted" style={{ fontSize: 'var(--fs-11)', flex: 'none', marginLeft: 'auto' }}>
        {prev.tested_at ? new Date(prev.tested_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}
      </span>
    </div>
  );
}

export function Toasts() {
  const toasts = useSelector((s) => s.session.toasts);
  const dispatch = useDispatch();
  useEffect(() => {
    if (!toasts.length) return undefined;
    const t = setTimeout(() => dispatch(toastDismissed(toasts[0].id)), 4200);
    return () => clearTimeout(t);
  }, [toasts, dispatch]);
  if (!toasts.length) return null;
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dispatch(toastDismissed(t.id))}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Progress({ value, width = 64 }) {
  return (
    <span className="bar" style={{ width, display: 'inline-block', verticalAlign: 'middle' }}>
      <span style={{ width: `${value}%` }} />
    </span>
  );
}

export function Loading({ what = 'items' }) {
  return (
    <div className="empty muted" style={{ fontSize: 'var(--fs-12)' }}>
      Loading {what}…
    </div>
  );
}
