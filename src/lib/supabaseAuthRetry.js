import { supabase } from './supabase';

export const AUTH_SESSION_EXPIRED_CODE = 'AUTH_SESSION_EXPIRED';

function getErrorStatus(error) {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.context?.status,
    error?.response?.status,
  ];

  for (const value of candidates) {
    const status = Number(value);
    if (Number.isFinite(status)) return status;
  }

  return null;
}

export function isSupabaseAuthError(error) {
  if (!error) return false;

  const status = getErrorStatus(error);
  if (status === 401) return true;

  const code = String(error?.code ?? '').toUpperCase();
  if (
    code === AUTH_SESSION_EXPIRED_CODE ||
    code === 'PGRST301' ||
    code === 'PGRST302'
  ) {
    return true;
  }

  const message = String(error?.message ?? error ?? '').toLowerCase();

  return [
    'jwt expired',
    'jwt is expired',
    'invalid jwt',
    'expired jwt',
    'token has expired',
    'access token expired',
    'invalid token',
    'not authenticated',
  ].some((fragment) => message.includes(fragment));
}

function createSessionExpiredError(cause = null) {
  const error = new Error(
    'Ta session a expiré. Reconnecte-toi puis recommence.'
  );
  error.code = AUTH_SESSION_EXPIRED_CODE;
  if (cause) error.cause = cause;
  return error;
}

export async function refreshSupabaseSession() {
  const { data, error } = await supabase.auth.refreshSession();

  if (error || !data?.session?.access_token) {
    throw createSessionExpiredError(error);
  }

  return data.session;
}

export async function withSupabaseAuthRetry(operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isSupabaseAuthError(error)) {
      throw error;
    }

    await refreshSupabaseSession();

    try {
      return await operation();
    } catch (retryError) {
      if (isSupabaseAuthError(retryError)) {
        throw createSessionExpiredError(retryError);
      }

      throw retryError;
    }
  }
}

export async function getAuthenticatedUserWithRetry() {
  return withSupabaseAuthRetry(async () => {
    const { data, error } = await supabase.auth.getUser();

    if (error) throw error;
    if (!data?.user?.id) throw createSessionExpiredError();

    return data.user;
  });
}

export async function runSupabaseRequestWithAuthRetry(request) {
  return withSupabaseAuthRetry(async () => {
    const result = await request();

    if (result?.error) {
      throw result.error;
    }

    return result?.data;
  });
}
