import { toast } from 'sonner'

/**
 * Wrapper for user-initiated write requests. Shows a toast.error on failure.
 * Only use for mutations — leave background reads silent.
 */
export async function fetchWithToast<T = unknown>(
  url: string,
  options: RequestInit,
  errorMessage = 'Something went wrong — please try again',
): Promise<T | null> {
  try {
    const res = await fetch(url, options)
    if (!res.ok) {
      const body = await res.text().catch(() => res.status.toString())
      toast.error(errorMessage, { description: body.slice(0, 100) })
      return null
    }
    return res.json() as Promise<T>
  } catch {
    toast.error(errorMessage)
    return null
  }
}
