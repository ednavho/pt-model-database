import { cn } from '@/utils/cn';
import { VettingStatus } from '@/types/database';

interface VettingBadgeProps {
  status: VettingStatus;
  className?: string;
}

const statusConfig: Record<VettingStatus, { label: string; classes: string }> = {
  vetted: {
    label: 'Vetted',
    classes: 'bg-green-50 text-green-700 border-green-200',
  },
  potentially_problematic: {
    label: 'Potentially Problematic',
    classes: 'bg-orange-50 text-orange-700 border-orange-200',
  },
  unknown: {
    label: 'Unknown',
    classes: 'bg-red-50 text-red-700 border-red-200',
  },
};

export default function VettingBadge({ status, className }: VettingBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.unknown;
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-xs border rounded-[8px] font-medium',
        config.classes,
        className
      )}
    >
      {config.label}
    </span>
  );
}
