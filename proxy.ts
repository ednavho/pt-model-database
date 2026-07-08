import { updateSession } from '@/utils/supabase/middleware';
import { type NextRequest, NextResponse } from 'next/server';

// Pages that require the user to be signed in
const PROTECTED_PAGES = ['/models/new'];
const PROTECTED_PAGE_RE = /^\/models\/[^/]+\/edit$/;

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const path = request.nextUrl.pathname;
  const isProtected =
    PROTECTED_PAGES.includes(path) || PROTECTED_PAGE_RE.test(path);

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/signin';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
