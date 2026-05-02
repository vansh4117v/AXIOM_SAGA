import { FileCode, GitPullRequest, User, ListChecks, AlertTriangle, MessageSquare, Copy, Check, Shield } from 'lucide-react';
import { useState } from 'react';

export default function BriefingPanel({ briefing, status }) {
  const loading = status === 'processing';

  return (
    <div className="bg-bg-card border border-border-subtle rounded-2xl p-5 flex flex-col gap-5 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-sage-muted">
          Situational Briefing
        </h2>
        {briefing && <ConfidenceBadge value={briefing.overall_confidence} />}
      </div>

      {loading && !briefing && <SkeletonBriefing />}

      {briefing && (
        <div className="space-y-4 animate-[fadeIn_0.4s_ease]">
          {/* Context */}
          <Section icon={<FileCode size={14} />} title="Context">
            <p className="text-sm text-sage-secondary leading-relaxed">{briefing.context_summary}</p>
          </Section>

          {/* Owner */}
          {briefing.primary_owner && (
            <Section icon={<User size={14} />} title="Recommended Owner">
              <div className="flex items-center gap-3 p-3 bg-bg-elevated rounded-lg border border-border-subtle">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center text-white text-sm font-semibold shrink-0">
                  {briefing.primary_owner.name?.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-medium text-sage-primary">{briefing.primary_owner.name}</p>
                  <p className="text-xs text-sage-muted">
                    {briefing.primary_owner.role} · {briefing.primary_owner.team}
                    {briefing.primary_owner.github_handle && (
                      <span className="ml-1 font-mono text-sage-secondary">@{briefing.primary_owner.github_handle}</span>
                    )}
                  </p>
                  <p className="text-xs text-sage-muted mt-0.5 italic">{briefing.primary_owner.match_reason}</p>
                </div>
              </div>
            </Section>
          )}

          {/* Steps */}
          {briefing.suggested_steps?.length > 0 && (
            <Section icon={<ListChecks size={14} />} title="Suggested Steps">
              <div className="space-y-2">
                {briefing.suggested_steps.map((step, i) => (
                  <div key={i} className="flex gap-3 p-2.5 rounded-lg bg-bg-elevated/60 border border-border-subtle">
                    <div className="w-6 h-6 rounded-full bg-accent/15 text-accent-hover flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      {step.step_number}
                    </div>
                    <div>
                      <p className="text-sm text-sage-primary font-medium">{step.action}</p>
                      <p className="text-xs text-sage-muted mt-0.5">{step.rationale}</p>
                      {step.estimated_effort_hours && (
                        <span className="text-[0.625rem] font-mono text-sage-muted mt-1 inline-block">
                          ~{step.estimated_effort_hours}h
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Risk */}
          {briefing.risk_flags?.length > 0 && (
            <Section icon={<Shield size={14} />} title={`Risk Flags — ${briefing.overall_risk_level || 'medium'}`}>
              <div className="space-y-2">
                {briefing.risk_flags.map((flag, i) => (
                  <RiskFlag key={i} flag={flag} />
                ))}
              </div>
            </Section>
          )}

          {/* Risk summary */}
          {briefing.risk_summary && (
            <p className="text-xs text-sage-muted italic border-l-2 border-orange-600/40 pl-3">
              {briefing.risk_summary}
            </p>
          )}

          {/* Ask Senior */}
          {briefing.ask_senior_message && (
            <div className="rounded-xl border border-accent/25 bg-accent/5 p-4">
              <p className="text-[0.6875rem] font-semibold text-accent-hover uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <MessageSquare size={12} />
                Suggested message to send
              </p>
              <p className="text-sm text-sage-secondary whitespace-pre-wrap leading-relaxed">
                {briefing.ask_senior_message}
              </p>
              <CopyButton text={briefing.ask_senior_message} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ icon, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-sage-muted">{icon}</span>
        <p className="text-[0.6875rem] font-semibold text-sage-muted uppercase tracking-wider">{title}</p>
      </div>
      {children}
    </div>
  );
}

function RiskFlag({ flag }) {
  const cfg = {
    critical: { color: 'text-red-400', bg: 'bg-red-500/8 border-red-500/20' },
    high:     { color: 'text-orange-400', bg: 'bg-orange-500/8 border-orange-500/20' },
    medium:   { color: 'text-yellow-400', bg: 'bg-yellow-500/8 border-yellow-500/20' },
    low:      { color: 'text-blue-400', bg: 'bg-blue-500/8 border-blue-500/20' },
  };
  const c = cfg[flag.severity] || cfg.medium;
  return (
    <div className={`rounded-lg border p-3 ${c.bg}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={13} className={`mt-0.5 shrink-0 ${c.color}`} />
        <div>
          <p className={`text-sm font-medium ${c.color}`}>{flag.flag}</p>
          <p className="text-xs text-sage-muted mt-0.5">
            Evidence: {flag.evidence} — {flag.recommendation}
          </p>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy}
      className="mt-3 flex items-center gap-1.5 text-xs text-accent-hover hover:text-accent border border-accent/30 px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy message'}
    </button>
  );
}

function ConfidenceBadge({ value }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const cls = pct >= 75 ? 'bg-green-900/50 text-green-300 border-green-700/40'
            : pct >= 50 ? 'bg-yellow-900/50 text-yellow-300 border-yellow-700/40'
            : 'bg-red-900/50 text-red-300 border-red-700/40';
  return (
    <span className={`text-sm font-mono font-bold px-3 py-1 rounded-full border ${cls}`}>
      {pct}%
    </span>
  );
}

function SkeletonBriefing() {
  return (
    <div className="space-y-5">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-3 w-24 animate-shimmer rounded" />
          <div className="h-4 animate-shimmer rounded w-full" />
          <div className="h-4 animate-shimmer rounded w-3/4" />
        </div>
      ))}
    </div>
  );
}
