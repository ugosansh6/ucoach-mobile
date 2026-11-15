/**
 * Weekly removal is an explicit user mutation. Timeouts do not prove a failed
 * transaction, so re-read the user's persisted row before treating it as done.
 */
export async function withWeekRemovalTimeout(operation, timeoutMs = 15000) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error('Le retrait met trop de temps à répondre.');
      error.code = 'WEEK_REMOVE_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function isConfirmedWeekRemovalRow(row) {
  return row?.status === 'skipped' &&
    row?.planning_context_json?.user_removed === true;
}

export function weekRemovalFeedback(error) {
  const message = String(error?.message ?? '');
  if (error?.code === 'WEEK_REMOVE_TIMEOUT') {
    return 'Réponse trop longue. Retrait non confirmé : actualise Ma semaine avant de réessayer.';
  }
  if (/This session can no longer be removed|in_progress|completed/i.test(message)) {
    return 'Cette séance a déjà commencé ou est terminée : son historique est protégé.';
  }
  if (/This item can no longer be removed|already skipped/i.test(message)) {
    return 'Cette séance n’est plus disponible au retrait. Actualise Ma semaine.';
  }
  if (error?.code === 'AUTH_SESSION_EXPIRED') {
    return 'Ta connexion a expiré. Reconnecte-toi avant de réessayer.';
  }
  return 'Le retrait n’a pas pu être confirmé. Réessaie ou actualise Ma semaine.';
}
