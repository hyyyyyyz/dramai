/**
 * The client checks a request body against the contract before it sends anything (`@dramai/api` parses the body with
 * its schema). When that fails the error is a validation error of the schema library, not an `ApiError`. This reads the
 * first problem out of it: which field (as a dotted path), and whether it was too long, too short or empty.
 */
export type RequestProblem = {
  path: string
  kind: 'too_big' | 'too_small' | 'empty' | 'other'
  limit?: number
  message: string
}

type Issue = {
  code?: string
  path?: (string | number)[]
  message?: string
  maximum?: number
  minimum?: number
}

export function requestProblem(err: unknown): RequestProblem | undefined {
  const issues = (err as { issues?: unknown } | null)?.issues
  if (!Array.isArray(issues) || issues.length === 0) return undefined
  const i = issues[0] as Issue
  const path = (i.path ?? []).join('.')
  const message = i.message ?? ''
  if (i.code === 'too_big' && typeof i.maximum === 'number')
    return { path, kind: 'too_big', limit: i.maximum, message }
  if (i.code === 'too_small' && typeof i.minimum === 'number')
    return i.minimum === 1
      ? { path, kind: 'empty', message }
      : { path, kind: 'too_small', limit: i.minimum, message }
  return { path, kind: 'other', message }
}
