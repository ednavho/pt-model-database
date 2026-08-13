import RiskBadge from '@/components/ui/RiskBadge';
import { CATEGORY_LABELS, fetchModelCard, formatBytes } from '@/lib/modelCards';
import Link from 'next/link';
import { notFound } from 'next/navigation';

/** Copied inline from app/workflow-review/page.tsx's ArrowIcon — kept
 *  inline (not extracted to a shared component) since it's a Figma asset
 *  snippet, same reasoning as the original. inline-block keeps it attached
 *  to the last line of a wrapped link rather than dropping to its own line. */
function ArrowIcon() {
  return (
    <svg width="7" height="7" viewBox="0 0 9 9" fill="none" className="inline-block ml-1 align-middle">
      <path
        d="M8.5 7.27647L8.40588 0.59412L1.72353 0.500001M8.40588 0.59412L0.5 8.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExternalLink({ href, label }: { href: string; label?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-60 break-all">
      {label ?? href}
      <ArrowIcon />
    </a>
  );
}

/** Row label/value treatment matches components/ui/ModelProvenanceCard.tsx
 *  and the Package Workflow Wizard's model cards (same 12px label / 13px
 *  value scale) — stacked one-per-row rather than PWW's fixed 4-column
 *  grid, since this page has more fields than PWW's compact list card was
 *  ever meant to hold. Value column is capped at 4/5 width (matching
 *  workflow-review's RequirementCard) so long values/links wrap before
 *  reaching the card's edge rather than filling it exactly. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-1">
      <span className="text-[12px] text-[#939393]">{label}</span>
      <span className="text-[13px] text-black min-w-0 max-w-4/5">{value ?? '—'}</span>
    </div>
  );
}

/** Same border/radius/padding as PWW's model cards (border-[#E9E9E9],
 *  rounded-[8px], p-5) so this page's "frames" read as the same design
 *  language, just carrying a section label since this page groups several
 *  frames rather than showing one card per model. leading-none on the
 *  title keeps the gap to its content a clean 16px (mb-4) rather than
 *  that plus the label's own line-height padding. Labels are passed in
 *  already sentence/title-cased ("License Findings", not "LICENSE
 *  FINDINGS") — no uppercase transform here, unlike a typical eyebrow
 *  label. */
function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#E9E9E9] rounded-[8px] p-5 mb-4">
      <p className="text-[13px] font-semibold leading-none text-black mb-4">{label}</p>
      {children}
    </div>
  );
}

function Section({ label, text }: { label: string; text: string | null }) {
  return (
    <Frame label={label}>
      {text ? (
        <p className="text-[13px] text-black whitespace-pre-wrap">{text}</p>
      ) : (
        <p className="text-[13px] text-[#939393]">Nothing recorded yet.</p>
      )}
    </Frame>
  );
}

export default async function ModelDetailPage({
  params,
}: {
  params: Promise<{ id: string[] }>;
}) {
  const { id } = await params;
  const recordId = id.join('/');

  const m = await fetchModelCard(recordId);
  if (!m) notFound();

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-12">
      <div className="mb-8">
        <Link href="/models" className="text-[13px] text-[#939393] hover:text-black mb-4 inline-flex items-center gap-1">
          <span className="text-[18px] leading-none">‹</span>
          <span>Back to Models</span>
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold text-black mb-1">{m.display_name}</h1>
            {m.requirement && <p className="font-mono text-[12px] text-[#939393]">{m.requirement}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <RiskBadge record={m} size="md" />
          </div>
        </div>
      </div>

      <Frame label="Record Info">
        <Row label="Record ID" value={m.record_id} />
      </Frame>

      <Frame label="Provenance">
        <div className="flex flex-col gap-4">
          <Row label="Category" value={CATEGORY_LABELS[m.category] ?? m.category} />
          <Row label="Filename" value={m.requirement} />
          <Row
            label="License"
            value={
              m.provenance.license_url ? (
                <ExternalLink href={m.provenance.license_url} label={m.provenance.license_id ?? m.provenance.license_url} />
              ) : (
                m.provenance.license_id
              )
            }
          />
          <Row
            label="Attribution"
            value={
              m.provenance.attribution_url ? (
                <ExternalLink href={m.provenance.attribution_url} label={m.provenance.attribution_name ?? m.provenance.attribution_url} />
              ) : (
                m.provenance.attribution_name
              )
            }
          />
          <Row
            label="Download"
            value={m.provenance.download_url ? <ExternalLink href={m.provenance.download_url} /> : null}
          />
          <Row label="File Size" value={formatBytes(m.provenance.size_bytes)} />
          <Row label="Reviewer" value={m.provenance.reviewer} />
          <Row label="Reviewed At" value={m.provenance.reviewed_at} />
        </div>
      </Frame>

      <Section label="License Findings" text={m.provenance.license_findings} />
      <Section label="Evidence" text={m.provenance.evidence} />
      <Section label="Rationale" text={m.provenance.rationale} />
    </div>
  );
}
