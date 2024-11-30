import { NextResponse } from 'next/server'

export async function middleware(request) {
  const lastCleanupTime = request.cookies.get('lastCleanupTime')
  const now = Date.now()
  
  if (lastCleanupTime && (now - parseInt(lastCleanupTime)) < 3600000) {
    return NextResponse.next()
  }

  const response = NextResponse.next()
  
  response.cookies.set('lastCleanupTime', now.toString(), {
    maxAge: 3600
  })

  return response
}

export const config = {
  matcher: [
    '/',
    '/now-playing',
    '/album/:path*',
    '/artist/:path*', 
    '/collection/:path*',
    '/mix/:path*',
    '/playlist/:path*',
    '/phone-auth',
    '/((?!api|_next/static|_next/image|favicon.ico|.png).*)',
  ],
}