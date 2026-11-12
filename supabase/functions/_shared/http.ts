export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

export function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : 'The request could not be completed.'
  return jsonResponse({ error: message }, status)
}

export function isOptions(request: Request) {
  return request.method === 'OPTIONS'
}

export async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>
  } catch {
    throw new Error('Request body must be valid JSON.')
  }
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
