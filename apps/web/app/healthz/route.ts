export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response(JSON.stringify({ status: 'ok', service: 'havefolio-web' }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
    },
  });
}
