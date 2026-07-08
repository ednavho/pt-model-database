import { INTERNAL_EMAILS } from '@/config/auth';

export function isInternalUser(email: string | null | undefined): boolean {
  return !!email && INTERNAL_EMAILS.some((e) => e.toLowerCase() === email.toLowerCase());
}
